// What the narrator says (js/narration.js): one module, used by the player to speak and by tools/gen-audio.mjs to record.
// Recordings are keyed by the exact spoken text, so a change here is a change to every recording: it should be deliberate.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { narration, spoken } from "../js/narration.js";

const dir = new URL("../playbooks/", import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));

test("the transcript of the format example is pinned (change the rules on purpose: update the fixture, then re-record)", () => {
  const want = JSON.parse(fs.readFileSync(new URL("./fixtures/narration/kafka-rebalance-storm.json", import.meta.url), "utf8"));
  assert.deepEqual(narration(read("kafka-rebalance-storm.json")), want);
});

test("every playbook has a transcript: sentences, once each, already spoken", () => {
  for (const { id, file } of read("index.json")) {
    const lines = narration(read(file));
    assert.ok(lines.length >= 20, `${id}: ${lines.length} sentences`);
    assert.equal(new Set(lines).size, lines.length, `${id}: no sentence twice`);
    for (const l of lines) assert.equal(spoken(l), l, `${id}: "${l}" is already in its spoken form`);
  }
});

test("speech rules: units, percentiles, code names", () => {
  assert.equal(spoken("p99 is 20 MB/s"), "99th percentile is 20 megabytes per second");
  assert.equal(spoken("check `pg_stat_activity` and max.poll.interval.ms"), "check pg stat activity and max poll interval");
  assert.equal(spoken("slow to call poll(), which"), "slow to call poll, which");
});

test("the built player speaks from the module (no copy of its own)", () => {
  const out = new URL("./.tmp-narration-build.html", import.meta.url).pathname;
  execFileSync(process.execPath, [new URL("../build-single.mjs", import.meta.url).pathname, out], { stdio: "pipe" });
  const html = fs.readFileSync(out, "utf8"); fs.rmSync(out);
  assert.ok(html.includes("const __narration = (() =>"), "js/narration.js is inlined into the player");
  assert.ok(!html.includes("@narration"), "the marker was replaced");
  assert.ok(!/function spoken\(t\)[\s\S]*function spoken\(t\)/.test(html), "one spoken(), the module's");
});
