import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validate, simulate, alertEvents } from "../js/playbook.js";
import { buildTools } from "../js/tools.js";

const dir = new URL("../playbooks/", import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
const index = read("index.json");

test("every bundled playbook validates and is listed in index.json", () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
  assert.deepEqual(index.map((p) => p.file).sort(), files);
  for (const item of index) {
    const pb = read(item.file), r = validate(pb);
    assert.equal(r.ok, true, `${item.file}: ${r.errors.join("; ")}`);
    assert.equal(pb.meta.id, item.id);
    assert.equal(r.world.key_moments.length, item.key_moments);
  }
});

test("validate reports actionable errors and never throws", () => {
  assert.deepEqual(validate(null).errors, ["the playbook must be a JSON object"]);
  const pb = read("kafka-rebalance-storm.json");
  pb.timeline[1].effects = [{ target: "nope", color: "red" }];
  pb.dashboard[0].metrics.push("missing");
  const r = validate(pb);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown effect target "nope"')));
  assert.ok(r.errors.some((e) => e.includes("unknown metric missing")));
  assert.equal(r.world, null);
});

test("curves follow keyframes and alerts fire from them", () => {
  const pb = read("kafka-rebalance-storm.json"), s = simulate(pb);
  assert.equal(s.lag.length, pb.meta.duration_s + 1);
  assert.equal(s.lag[0], 300);
  const ev = alertEvents(pb, s);
  assert.ok(ev.some((e) => e.alert === "lag-high" && e.event === "fires" && e.t === 140));
});

test("page tools reject unknown arguments and report the world at any second", async () => {
  const pb = read("pg-replication-lag.json");
  const tools = Object.fromEntries(buildTools({
    index: () => index, simxp: { current: pb }, player: () => null,
    parsePlaybook: (x) => (typeof x === "string" ? JSON.parse(x) : x),
  }).map((t) => [t.name, t]));
  await assert.rejects(tools.list_playbooks.execute({ foo: 1 }), /unknown argument\(s\) foo/);
  const st = await tools.get_state.execute({ t: 150 });
  assert.equal(st.world.t, 150);
  assert.ok(st.world.alerts_firing.some((a) => a.id === "lag-high"));
  const v = await tools.validate_playbook.execute({ playbook: JSON.stringify(pb), at: [100] });
  assert.equal(v.ok, true);
  assert.equal(v.world.at[0].t, 100);
});

test("the story-to-playbook skill ships the same validator and examples as v2", () => {
  const skill = new URL("../../.claude/skills/story-to-playbook/", import.meta.url);
  const same = (a, b) => assert.equal(fs.readFileSync(a, "utf8"), fs.readFileSync(b, "utf8"), `${b.pathname} is out of date; copy it from ${a.pathname}`);
  same(new URL("../js/playbook.js", import.meta.url), new URL("scripts/playbook.js", skill));
  for (const f of fs.readdirSync(new URL("examples/", skill))) same(new URL(f, dir), new URL("examples/" + f, skill));
});
