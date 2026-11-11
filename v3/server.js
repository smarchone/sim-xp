#!/usr/bin/env node
// sim-xp local server: serves v3/ (the page at /, the playbooks at /playbooks/), watches v3/playbooks/, and relays a chat to a
// Claude Code worker (/simxp) that writes playbooks there. GitHub Pages serves the same page without this server, and the
// page then has no chat.
//   node v3/server.js              http://127.0.0.1:3470   (PORT=… to change it)
//
// Chat threads: "new" (the index's chat: every exchange there makes a new playbook) and one per playbook id (the player's
// chat: changes to that playbook). The worker's protocol:
//   GET  /api/jobs/next?timeout=300   long-poll; claims the waiting messages of one thread (oldest first) as a job
//   POST /api/jobs/progress           { job_id, text }       a status line in the job's chat ("Writing the playbook…")
//   POST /api/jobs/complete           { job_id, reply, playbook? }   Claude's reply; playbook: the id it wrote (required for "new")
//   POST /api/jobs/release            { job_id? }            gives the messages back without replying
//   POST /api/note                    { thread, text }       a status line after a job (e.g. narration recorded)
// A worker polls only when it is idle, so a poll that arrives while a job is still claimed means the worker that claimed it is
// gone (stopped mid-job, its session closed): that job is handed to the new poller.
// Narration: when a job completes having written or changed a playbook, the server records it in the background
// (tools/gen-audio.mjs, one playbook at a time; an edit made while it records is recorded again after), and says so in that
// playbook's chat. The worker goes straight back to listening. SIMXP_AUDIO=off turns this off (the tests do).
// A recording is stopped after SIMXP_AUDIO_TIMEOUT minutes (default 10; a new playbook takes 3–4, an edit seconds). What it
// rendered is kept in the cache, so the next recording of that playbook carries on from there. The browser can also stop a job
// (POST /api/jobs/cancel { thread }); a reply that comes later for it is refused with 409.
// The browser:
//   GET  /api/health · GET /api/chat?thread=… · POST /api/chat { thread, text } · GET /api/events (SSE: chat, worker,
//   playbooks { ids }, audio { ids })
// When a file in v3/playbooks/ changes, index.json is rebuilt (tools/build-index.mjs) and the browser is told, so the list
// and an open playbook reload. The page itself is rebuilt (build-single.mjs) at start and when its sources change.
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const V3 = dirname(fileURLToPath(import.meta.url)), PB = join(V3, "playbooks"), PORT = Number(process.env.PORT || 3470);
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".mp3": "audio/mpeg", ".png": "image/png", ".svg": "image/svg+xml" };

// ---------- events to the browser (SSE) ----------
const clients = new Set();
function emit(type, data) { const s = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); }

// ---------- chat threads and jobs (in memory: a restart starts the chat afresh; the playbooks are on disk) ----------
const threads = new Map();   // thread -> [{ author: "user"|"claude"|"status", text, at }]
const pending = [];          // [{ thread, text, at }] user messages not yet given to the worker
let job = null;              // { id, thread, messages }
const waiters = new Set();   // long-polls waiting for a job
let lastSeen = 0;            // when the worker last polled (it is "listening" while it polls or works)
const log = (t) => (threads.has(t) ? threads.get(t) : threads.set(t, []).get(t));
const validThread = (t) => t === "new" || /^[\w.-]{1,120}$/.test(t);
function post(thread, author, text) { const m = { author, text: String(text), at: new Date().toISOString() }; log(thread).push(m); emit("chat", { thread }); return m; }
const listening = () => waiters.size > 0 || !!job || Date.now() - lastSeen < 15000;
let wasListening = false;
function workerChanged() { const l = listening(); if (l !== wasListening) { wasListening = l; emit("worker", { listening: l }); } }
setInterval(workerChanged, 3000).unref();

function takeJob() {
  if (job || !pending.length) return null;
  const thread = pending[0].thread, messages = [];
  for (let i = 0; i < pending.length;) if (pending[i].thread === thread) messages.push(pending.splice(i, 1)[0]); else i++;
  job = { id: randomUUID(), thread, messages, since: Date.now() };
  emit("chat", { thread, busy: true, since: job.since });
  return job;
}
function jobView(j) {
  const file = j.thread === "new" ? null : join(PB, j.thread + ".json");
  return { job: { id: j.id, thread: j.thread, playbook: j.thread === "new" ? null : j.thread, file: file && existsSync(file) ? file : null,
    playbooks_dir: PB, repo: dirname(V3), messages: j.messages.map(({ text, at }) => ({ text, at })),
    context: log(j.thread).filter((m) => m.author !== "status" && !j.messages.some((x) => x.at === m.at && x.text === m.text)).slice(-20).map(({ author, text }) => ({ author, text })) } };
}
function offerJob() { if (!waiters.size) return; const j = takeJob(); if (!j) return; const w = waiters.values().next().value; waiters.delete(w); w(jobView(j)); }
function nextJob(timeout, signal) {
  lastSeen = Date.now(); workerChanged();
  if (job) {   // claimed by a worker that is no longer there: give it to this one
    post(job.thread, "status", "Claude was restarted and is picking this up again.");
    job.since = Date.now(); emit("chat", { thread: job.thread, busy: true, since: job.since });
    return Promise.resolve(jobView(job));
  }
  const j = takeJob(); if (j) return Promise.resolve(jobView(j));
  return new Promise((res) => {
    const done = (v) => { clearTimeout(timer); waiters.delete(done); lastSeen = Date.now(); res(v); workerChanged(); };
    const timer = setTimeout(() => done({ job: null }), Math.max(1, Math.min(600, timeout || 300)) * 1000);
    signal.addEventListener("abort", () => { clearTimeout(timer); waiters.delete(done); workerChanged(); });
    waiters.add(done); workerChanged();
  });
}
function current(id) {
  if (!job) throw httpError(409, "No job in progress. Poll /api/jobs/next for the next one.");
  if (id && id !== job.id) throw httpError(409, `Job ${id} is no longer active. Poll /api/jobs/next again.`);
  return job;
}
function complete(b) {
  const j = current(b.job_id), reply = String(b.reply || "").trim() || "Done.";
  let thread = j.thread;
  if (thread === "new") {
    const id = String(b.playbook || "");
    if (!/^[\w.-]{1,120}$/.test(id) || !existsSync(join(PB, id + ".json"))) throw httpError(400, `playbook must name the file you wrote in ${PB} (its meta.id)`);
    // the exchange moves into the new playbook's thread, so its player chat carries on from here; the index's thread starts afresh
    log(id).push(...log("new").filter((m) => j.messages.some((x) => x.at === m.at && x.text === m.text) || m.author === "status"));
    threads.set("new", log("new").filter((m) => !j.messages.some((x) => x.at === m.at && x.text === m.text) && m.author !== "status"));
    thread = id;
    post(id, "claude", reply);
    emit("chat", { thread: "new", created: id, reply });
  } else post(thread, "claude", reply);
  const wrote = j.thread === "new" || b.changed !== false;   // a reply to a question can say { changed: false }: nothing to record
  job = null; lastSeen = Date.now(); emit("chat", { thread, busy: false }); offerJob();
  if (wrote) recordAudio(thread);
  return { ok: true, thread, narration: wrote && AUDIO ? "recording in the background" : "not recorded" };
}
function release(b) {
  if (!job || (b.job_id && b.job_id !== job.id)) return { ok: true };
  pending.unshift(...job.messages); const t = job.thread; job = null; emit("chat", { thread: t, busy: false }); offerJob();
  return { ok: true };
}

// ---------- files: rebuild index.json when a playbook changes, and tell the browser ----------
const run = (script, args = []) => new Promise((res) => execFile(process.execPath, [join(V3, script), ...args], { cwd: V3 }, (err, out, errOut) => res({ ok: !err, out: String(out) + String(errOut) })));
let changed = new Set(), audioChanged = new Set(), timer = null;
watch(PB, { recursive: true }, (_type, name) => {
  if (!name) return;
  const f = String(name).split(sep).join("/");
  if (f === "index.json" || f.endsWith("~") || f.includes(".tmp")) return;
  const a = f.match(/^audio\/([^/]+)\//);
  if (a) audioChanged.add(a[1]); else if (/^[\w.-]+\.json$/.test(f)) changed.add(f.slice(0, -5)); else return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ids = [...changed], aids = [...audioChanged]; changed = new Set(); audioChanged = new Set();
    if (ids.length) { const r = await run("tools/build-index.mjs"); if (!r.ok) console.warn("index.json not rebuilt:", r.out.trim()); emit("playbooks", { ids }); }
    if (aids.length) emit("audio", { ids: aids });
  }, 400);
});
// ---------- narration, recorded in the background (one playbook at a time) ----------
const AUDIO = process.env.SIMXP_AUDIO !== "off", AUDIO_LIMIT_MIN = Number(process.env.SIMXP_AUDIO_TIMEOUT) || 10, audioQueue = new Set();
let recording = null;
function recordAudio(id) { if (!AUDIO || !existsSync(join(PB, id + ".json"))) return; audioQueue.add(id); pumpAudio(); }
function pumpAudio() {
  if (recording || !audioQueue.size) return;
  const id = audioQueue.values().next().value; audioQueue.delete(id); recording = id;
  post(id, "status", "Recording the narration… (in the background; the playbook plays meanwhile)");
  // its own process group, so a timeout stops the headless Chrome and the model with it
  const child = spawn(process.execPath, [join(V3, "tools/gen-audio.mjs"), id], { cwd: dirname(V3), stdio: ["ignore", "pipe", "pipe"], detached: true });
  let tail = "", timedOut = false, progress = "";
  const limit = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGTERM"); } catch (e) { child.kill("SIGTERM"); } }, AUDIO_LIMIT_MIN * 60000);
  const keep = (d) => { tail = (tail + d).slice(-4000); const m = [...String(d).matchAll(/ (\d+)\/(\d+): /g)].pop(); if (m) progress = `${m[1]} of ${m[2]}`; };
  child.stdout.on("data", keep); child.stderr.on("data", keep);
  const finish = (code) => {
    if (recording !== id) return;   // close after error: already handled
    clearTimeout(limit); recording = null;
    const done = tail.match(/done: (\d+) generated/), lines = tail.trim().split("\n"), last = lines[lines.length - 1] || "";
    if (timedOut) post(id, "status", `The narration took longer than ${AUDIO_LIMIT_MIN} min and was stopped${progress ? ` at sentence ${progress}` : ""}. What it rendered is kept: it carries on from there the next time this playbook is recorded (after the next change, or run node v3/tools/gen-audio.mjs ${id}). Unrecorded sentences are read by the Google voice.`);
    else if (code === 0) post(id, "status", `Narration recorded${done ? ` (${done[1]} new sentence${done[1] === "1" ? "" : "s"})` : ""}.`);
    else {
      const why = /Cannot find (package|module) 'kokoro-js'/.test(tail) ? "kokoro-js is not installed: run npm install in v3/tools" : last.replace(/^gen-audio: /, "").slice(0, 200);
      post(id, "status", `Could not record the narration: ${why}. New sentences are read by the Google voice.`);
      console.warn(`narration for ${id} failed:\n${tail.trim()}`);
    }
    pumpAudio();
  };
  child.on("error", () => finish(1)); child.on("close", finish);
}

let building = null;
async function buildPage() { if (building) return building; building = run("build-single.mjs").then((r) => { building = null; if (!r.ok) console.warn("build failed:", r.out.trim()); return r; }); return building; }
for (const p of ["player.html", "page", "js"]) watch(join(V3, p), { recursive: p !== "player.html" }, () => { clearTimeout(buildPage.t); buildPage.t = setTimeout(buildPage, 300); });

// ---------- HTTP ----------
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
async function body(req) { let s = ""; for await (const c of req) { s += c; if (s.length > 1e6) throw httpError(413, "too large"); } try { return s ? JSON.parse(s) : {}; } catch (e) { throw httpError(400, "body must be JSON"); } }
const routes = {
  "GET /api/health": async () => ({ ok: true, playbooks: PB, listening: listening(), recording, audio_queue: [...audioQueue] }),
  "GET /api/chat": async (q) => { const t = q.get("thread") || "new"; if (!validThread(t)) throw httpError(400, "bad thread");
    // a message still waiting for the worker is marked queued (it is in the log once, from when it was sent)
    const waiting = new Set(pending.filter((m) => m.thread === t).map((m) => m.at + "\n" + m.text));
    return { thread: t, messages: log(t).map((m) => (m.author === "user" && waiting.has(m.at + "\n" + m.text) ? { ...m, queued: true } : m)), busy: !!job && job.thread === t, since: job && job.thread === t ? job.since : null, listening: listening() }; },
  "POST /api/chat": async (_q, b) => {
    const t = String(b.thread || "new"), text = String(b.text || "").trim();
    if (!validThread(t)) throw httpError(400, "bad thread"); if (!text) throw httpError(400, "empty message");
    if (t !== "new" && !existsSync(join(PB, t + ".json"))) throw httpError(404, `no playbook ${t} in v3/playbooks`);
    const m = { thread: t, text, at: new Date().toISOString() }; log(t).push({ author: "user", text, at: m.at }); pending.push(m);
    emit("chat", { thread: t }); offerJob(); return { ok: true, listening: listening() };
  },
  "GET /api/jobs/next": async (q, _b, signal) => nextJob(Number(q.get("timeout") ?? 300), signal),
  "GET /api/jobs/current": async () => (job ? jobView(job) : { job: null }),
  "POST /api/jobs/progress": async (_q, b) => { const j = current(b.job_id); post(j.thread, "status", b.text || "Working…"); return { ok: true }; },
  "POST /api/jobs/complete": async (_q, b) => complete(b),
  "POST /api/jobs/release": async (_q, b) => release(b),
  "POST /api/jobs/cancel": async (_q, b) => {   // from the browser: stop waiting for Claude on this thread (the job and its queued messages)
    const t = String(b.thread || ""); if (!validThread(t)) throw httpError(400, "bad thread");
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].thread === t) pending.splice(i, 1);
    if (job && job.thread === t) { job = null; offerJob(); }
    post(t, "status", "Stopped."); emit("chat", { thread: t, busy: false });
    return { ok: true };
  },
  "POST /api/note": async (_q, b) => { const t = String(b.thread || ""); if (!validThread(t) || t === "new") throw httpError(400, "thread must be a playbook id"); post(t, "status", b.text || ""); return { ok: true }; },
};
function serveFile(res, path) {
  const p = normalize(join(V3, decodeURIComponent(path)));
  if (!p.startsWith(V3 + sep) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });   // never a stale page or playbook
  res.end(readFileSync(p));
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`event: worker\ndata: ${JSON.stringify({ listening: listening() })}\n\n`);
      clients.add(res); const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const h = routes[`${req.method} ${url.pathname}`]; if (!h) throw httpError(404, "no such endpoint");
      const ac = new AbortController(); res.on("close", () => { if (!res.writableEnded) ac.abort(); });
      const out = await h(url.searchParams, req.method === "POST" ? await body(req) : null, ac.signal);
      if (ac.signal.aborted) return;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify(out));
    }
    if (url.pathname === "/" || url.pathname === "/index.html") { await (building || Promise.resolve()); return serveFile(res, "dist/sim-xp.html"); }
    return serveFile(res, url.pathname);
  } catch (e) {
    if (res.headersSent) return res.end();
    res.writeHead(e.status || 500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message }));
  }
});
await buildPage();
server.listen(PORT, "127.0.0.1", () => console.log(`sim-xp: http://127.0.0.1:${server.address().port}  (playbooks: ${PB}; chat worker: /simxp in Claude Code)`));
