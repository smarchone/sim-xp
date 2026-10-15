#!/usr/bin/env node
// Check a sim-xp playbook and print the world at each key moment, so an author can see whether the numbers tell the story.
// Usage: node scripts/validate.mjs playbook.json [--at 60,120]
// Exit code 1 on errors. Warnings never fail. The page's validate_playbook tool runs the same checks.
import fs from "node:fs";
import { validate, simulate, valuesAt } from "./playbook.js";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/validate.mjs playbook.json [--at 60,120]"); process.exit(2); }
let pb;
try { pb = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error("ERROR not valid JSON: " + e.message); process.exit(1); }

const { ok, errors, warnings, world } = validate(pb);
const fmt = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : String(v);
const line = values => Object.entries(values).map(([k, v]) => `${k}=${fmt(v)}`).join("  ");
if (world) {
  console.log("World at each key moment (no noise):");
  for (const k of world.key_moments) console.log(`  ${k.n}. t=${k.t}s ${k.title}\n     ${line(k.values)}`);
  const i = process.argv.indexOf("--at");
  if (i > 0) {
    const series = simulate(pb);
    console.log("World at requested times:");
    for (const t of String(process.argv[i + 1] || "").split(",").map(Number).filter(Number.isFinite)) console.log(`  t=${t}s  ${line(valuesAt(pb, series, t))}`);
  }
  console.log("Alerts: " + (world.alerts.length ? world.alerts.map(a => `${a.alert} ${a.event} at ${a.t}s`).join("; ") : "none fire"));
}
for (const w of warnings) console.log("WARN  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(ok ? `\nOK, ${warnings.length} warning(s)` : `\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(ok ? 0 : 1);
