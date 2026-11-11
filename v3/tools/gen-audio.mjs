#!/usr/bin/env node
// Records the narration (Kokoro's Heart voice) for a folder of playbooks, at authoring time: the player never makes speech itself.
// The audio goes next to the playbooks, in <folder>/audio/<id>/, so it is served wherever they are (GitHub, GitHub Pages, a
// local server) and the player finds it at <library folder>/audio/<id>/.
//   cd v3/tools && npm install                       once (kokoro-js; the model, ~330 MB, is downloaded on the first run and cached)
//   node v3/tools/gen-audio.mjs [--dir <folder>] [id…]
//     --dir   the playbook folder, with its index.json (default v3/playbooks; e.g. a clone of smarchone/simxp-playbooks)
//     id…     only these playbooks (default: every one in the folder's index.json)
// Needs Node and ffmpeg with libmp3lame (no browser).
//
// What is spoken comes from js/narration.js, the same module the player speaks from: narration(playbook) lists every sentence
// the narrator can say (both detail levels, Watch and Read), already rewritten for the ear, straight from the playbook file.
// So the player and these files never disagree about the text. Each playbook gets one file, <folder>/audio/<id>/narration-<hash>.mp3, holding all
// its sentences, and <folder>/audio/<id>/manifest.json saying where each one is, in seconds:
//   { "voice": "af_heart", "file": "narration-<hash>.mp3", "lines": { "<spoken sentence>": [start, length] } }
// A sentence the manifest lacks is spoken live by the player, as before.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { narration } from "../js/narration.js";

const V3 = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), di = args.indexOf("--dir");
const PBDIR = di >= 0 ? resolve(args.splice(di, 2)[1] || die("--dir needs a folder")) : join(V3, "playbooks");
const OUT = join(PBDIR, "audio"), VOICE = "af_heart", RATE = 24000;
if (!existsSync(join(PBDIR, "index.json"))) die(`no index.json in ${PBDIR}`);
const raw = JSON.parse(readFileSync(join(PBDIR, "index.json"), "utf8")), index = Array.isArray(raw) ? raw : raw.playbooks || [];
const want = args;
// a playbook named by id may be newer than index.json (just written): <id>.json in the folder is enough
const items = want.length ? want.map((id) => index.find((x) => x.id === id) || (/^[\w.-]+$/.test(id) && existsSync(join(PBDIR, id + ".json")) ? { id, file: id + ".json" } : die(`no playbook "${id}" in ${PBDIR}`))) : index;
function die(msg) { console.error("gen-audio: " + msg); process.exit(1); }

// ---- 1. the sentences, from the playbook (js/narration.js)
function linesOf(it) {
  let pb; try { pb = JSON.parse(readFileSync(join(PBDIR, it.file), "utf8")); } catch (e) { die(`${it.file}: ${e.message}`); }
  return narration(pb);
}

// ---- 2. the audio: Kokoro on the CPU, one sentence at a time, cached as raw PCM; then one MP3 per playbook
// The cache (v3/tools/.cache, not in git) keeps each sentence's samples under a hash of the voice and the text, so a rerun only
// renders the sentences that changed. A playbook's file is its sentences back to back with GAP s of silence around each, so the
// player can play a slice without catching the next one (and an MP3 decoder's few ms of offset do not clip a word).
const CACHE = join(V3, "tools/.cache", VOICE), GAP = 0.25;
const keyFor = (text) => createHash("sha1").update(VOICE + "\n" + text).digest("hex").slice(0, 16);
function toMp3(pcm, out) {
  return new Promise((res, rej) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "48k", out], { stdio: ["pipe", "ignore", "inherit"] });
    ff.on("error", rej); ff.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exited " + c))));
    ff.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

mkdirSync(CACHE, { recursive: true });
let tts = null, made = 0, kept = 0;
const used = new Set();
for (const it of items) {
  const dir = join(OUT, it.id), list = linesOf(it), parts = [], gap = new Float32Array(Math.round(GAP * RATE));
  mkdirSync(dir, { recursive: true });
  for (const [i, text] of list.entries()) {
    const k = keyFor(text), cf = join(CACHE, k + ".f32"); used.add(k + ".f32");
    if (existsSync(cf)) { kept++; const b = readFileSync(cf); parts.push([text, new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)]); continue; }
    if (!tts) {
      process.stdout.write("loading Kokoro (the first run downloads ~330 MB)…\n");
      const { KokoroTTS } = await import("kokoro-js");
      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
    }
    process.stdout.write(`${it.id} ${i + 1}/${list.length}: ${text.slice(0, 70)}\n`);
    const a = await tts.generate(text, { voice: VOICE, speed: 1 });
    if (a.sampling_rate !== RATE) die(`unexpected sample rate ${a.sampling_rate}`);
    writeFileSync(cf, Buffer.from(a.audio.buffer, a.audio.byteOffset, a.audio.byteLength)); made++;
    parts.push([text, a.audio]);
  }
  // one buffer: GAP, sentence, GAP, sentence, …, GAP; the manifest gives each sentence's start and length in seconds
  const total = gap.length * (parts.length + 1) + parts.reduce((n, [, p]) => n + p.length, 0), all = new Float32Array(total), manifest = { voice: VOICE, file: "", lines: {} };
  let at = gap.length;
  for (const [text, p] of parts) { all.set(p, at); manifest.lines[text] = [+(at / RATE).toFixed(3), +(p.length / RATE).toFixed(3)]; at += p.length + gap.length; }
  // the file is named by its content, so a browser never plays a stale copy
  const name = "narration-" + createHash("sha1").update(Buffer.from(all.buffer)).digest("hex").slice(0, 8) + ".mp3";
  manifest.file = name;
  if (!existsSync(join(dir, name))) await toMp3(all, join(dir, name));
  for (const f of readdirSync(dir)) if (f !== name && f !== "manifest.json") rmSync(join(dir, f));   // the older file, or per-sentence files from before
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  console.log(`${it.id}: ${list.length} sentences, ${(total / RATE / 60).toFixed(1)} min → audio/${it.id}/${name}`);
}
// with every playbook done, sentences no playbook says any more leave the cache
let pruned = 0;
if (!want.length) for (const f of readdirSync(CACHE)) if (!used.has(f)) { rmSync(join(CACHE, f)); pruned++; }
console.log(`done: ${made} generated, ${kept} from the cache${pruned ? `, ${pruned} dropped from the cache` : ""} → ${OUT}`);
