import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simxp-build-"));
const out = path.join(dir, "sim-xp.html");
execFileSync(process.execPath, [new URL("../build-single.mjs", import.meta.url).pathname, out], { stdio: "pipe" });
const html = fs.readFileSync(out, "utf8");
const open = '<script type="module">', at = html.indexOf(open);
const script = html.slice(at + open.length, html.lastIndexOf("</script>"));
const markup = html.slice(0, at);

test("the single file is one self-contained page for the artifact and for Pages", () => {
  assert.ok(html.length < 1024 * 1024, "stays well under the artifact limit");
  assert.ok(!/<(html|head|body)[\s>]/i.test(markup), "no document tags: the artifact publisher adds its own skeleton");
  assert.ok(!/data:,|data:[a-z]+\//.test(html), "no data: URIs: the artifact's public-sharing review refuses ones it can't read");
  assert.ok(/<title>sim-xp<\/title>/.test(html));
  for (const id of ["stage", "panel", "ask", "pb", "runBtn", "saved"]) assert.ok(markup.includes(`id="${id}"`), `#${id} is in the page`);
});

test("the script parses and carries only the two bundled playbooks; the rest load from the repo", () => {
  const file = path.join(dir, "check.mjs");
  fs.writeFileSync(file, script);
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  const index = JSON.parse(fs.readFileSync(new URL("../playbooks/index.json", import.meta.url), "utf8"));
  const bundled = ["kafka-load-test-until-it-breaks", "kafka-rebalance-storm"];
  for (const p of index) assert.equal(script.includes(`"id":"${p.id}"`), bundled.includes(p.id), `${p.id} is ${bundled.includes(p.id) ? "" : "not "}bundled`);
  assert.ok(script.includes("raw.githubusercontent.com") && script.includes('const DEFAULT_SRC = "smarchone/sim-xp@main/v2/playbooks"'));
  assert.ok(script.includes("const DEFAULT = SEEDS.find") && script.includes("const EXAMPLE = SEEDS.find"));
});
