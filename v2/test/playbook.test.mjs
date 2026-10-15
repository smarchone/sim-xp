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

test("the page uses the skill's validator and example, not copies", () => {
  const skill = "../../.claude/skills/story-to-playbook/";
  assert.equal(fs.readlinkSync(new URL("../js/playbook.js", import.meta.url)), skill + "scripts/playbook.js");
  assert.equal(fs.readlinkSync(new URL("kafka-rebalance-storm.json", dir)), skill + "examples/kafka-rebalance-storm.json");
});

test("intro and report context fields are checked, and bundled playbooks carry them", () => {
  for (const item of index) {
    const pb = read(item.file);
    assert.ok(pb.meta.background?.length >= 2 && pb.meta.cast?.length && pb.meta.watch?.length && pb.meta.learn?.length, `${item.file}: intro fields`);
    assert.ok(!validate(pb).warnings.some((w) => w.includes("meta.background")));
  }
  const pb = read("kafka-rebalance-storm.json");
  pb.meta.cast = [{ name: "x" }];
  pb.meta.background = [{ title: "t" }];
  pb.report.links = [{ label: "x", url: "http://insecure.example" }];
  pb.report.myths = [{ myth: "m" }];
  const r = validate(pb);
  for (const bit of ["meta.cast[0]", "meta.background[0]", "report.links[0]", "report.myths[0]"]) assert.ok(r.errors.some((e) => e.includes(bit)), bit);
  delete pb.meta.background;
  assert.ok(validate(read("kafka-rebalance-storm.json")).ok);
});

test("every panel says why it matters, and meta.clock / feed.key are checked", () => {
  for (const item of index) {
    const pb = read(item.file), r = validate(pb);
    assert.ok(pb.dashboard.every((p) => p.why), `${item.file}: panel why`);
    assert.ok(!r.warnings.some((w) => w.includes('"why"') || w.includes("add \"why\"")), item.file);
  }
  const pb = read("github-2018-split-brain.json");
  assert.equal(validate(pb).ok, true);
  pb.meta.clock = { start: "nope", scale: -1, changes: [{ t: 50, scale: 2 }, { t: 40, scale: 3 }] };
  pb.timeline.find((e) => e.feed).feed.key = "yes";
  const r = validate(pb);
  for (const bit of ["meta.clock.start", "meta.clock.scale", "meta.clock.changes[1]", "feed.key"]) assert.ok(r.errors.some((e) => e.includes(bit)), bit);
});

test("meta.layout.components must be 3, 4 or 5", () => {
  const pb = read("github-2018-split-brain.json");
  assert.equal(pb.meta.layout.components, 4);
  assert.equal(validate(pb).ok, true);
  pb.meta.layout.components = 7;
  assert.ok(validate(pb).errors.some((e) => e.includes("meta.layout.components")));
});
