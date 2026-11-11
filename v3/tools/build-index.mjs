#!/usr/bin/env node
// Builds v3/playbooks/index.json from the playbook files there (the default library: the sim-xp player reads index.json to list
// the playbooks and fetches a playbook only when it is clicked). The audio/ folder beside them is not read.
//   node v3/tools/build-index.mjs           write index.json
//   node v3/tools/build-index.mjs --check   fail if index.json is out of date (the v3 tests run this)
// Every entry is read from the playbook itself, so the index never needs editing by hand:
//   id <- meta.id (must equal the file name), title <- meta.title, story <- meta.story, duration_s <- meta.duration_s,
//   tags <- meta.tags, key_moments <- number of timeline events with a `beat`.
// This checks the fields the index needs. The full format check is the story-to-playbook skill's validate.mjs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../playbooks");
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json" && f !== "package.json").sort();
const problems = [], index = [];
for (const file of files) {
  let pb;
  try { pb = JSON.parse(readFileSync(join(dir, file), "utf8")); } catch (e) { problems.push(`${file}: not valid JSON (${e.message})`); continue; }
  const m = pb && pb.meta;
  if (!m || typeof m !== "object") { problems.push(`${file}: no meta object`); continue; }
  for (const k of ["id", "title", "story"]) if (typeof m[k] !== "string" || !m[k]) problems.push(`${file}: meta.${k} must be a non-empty string`);
  if (!Number.isFinite(m.duration_s) || m.duration_s <= 0) problems.push(`${file}: meta.duration_s must be a positive number`);
  if (m.id && file !== m.id + ".json") problems.push(`${file}: file name must be meta.id + ".json" (${m.id}.json)`);
  if (!Array.isArray(pb.timeline)) { problems.push(`${file}: timeline must be a list`); continue; }
  index.push({
    id: m.id, file, title: m.title, story: m.story, duration_s: m.duration_s,
    ...(Array.isArray(m.tags) && m.tags.length ? { tags: m.tags } : {}),
    key_moments: pb.timeline.filter((e) => e && e.beat).length,
  });
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
const out = JSON.stringify(index, null, 1) + "\n", path = join(dir, "index.json");
if (process.argv.includes("--check")) {
  let cur = ""; try { cur = readFileSync(path, "utf8"); } catch (e) { /* missing */ }
  if (cur !== out) { console.error("index.json is out of date. Run: node v3/tools/build-index.mjs"); process.exit(1); }
  console.log(`index.json is up to date (${index.length} playbooks)`);
} else { writeFileSync(path, out); console.log(`index.json: ${index.length} playbooks`); }
