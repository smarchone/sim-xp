#!/usr/bin/env node
// Builds sim-xp into ONE html file: the player, a collapsible side panel (chat with Claude, playbook box, saved list),
// and the bundled playbooks. The same file is the Claude artifact and the GitHub Pages site.
//   node v2/build-single.mjs [out]        default out: v2/dist/sim-xp.html
// Inlined: player.html (given to the frame as srcdoc), the validator, sidebar/page.{html,css,js}, every playbook in
// playbooks/index.json, and the format reference Claude reads (the schema part of the story-to-playbook skill).
// Fonts stay on Google Fonts, which an artifact may load. The file has no <html>/<head>/<body> tags because the artifact
// publisher adds its own skeleton; browsers accept that too.
// Publish the artifact with capabilities {sample: {}, downloads: true}. The chat needs `sample` and only works there.
// js/tools.js (the WebMCP tools) is kept in the repo but is not part of this build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || join(here, "dist", "sim-xp.html"));
const read = (p) => readFileSync(join(here, p), "utf8");

// Replace one exact snippet; fail loudly when the source drifts so the build never ships a half-patched page.
function patch(src, from, to, what) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`build-single: expected 1 match for ${what}, found ${n}`);
  return src.replace(from, () => to);
}
const inScript = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

// ---- validator as a scope (playbook.js uses ES exports)
const names = [];
const playbookJs = read("js/playbook.js").replace(/^export\s+(?:async\s+)?(const|function|let)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, id) => {
  names.push(id);
  return m.replace(/^export\s+/, "");
});
const validatorScope = `const __playbook = (() => {\n${playbookJs}\nreturn { ${names.join(", ")} };\n})();`;

// ---- the format reference Claude reads: the skill's schema and rules, without its file-and-workflow parts
const skill = readFileSync(join(here, "../.claude/skills/story-to-playbook/SKILL.md"), "utf8");
const spec = skill.slice(skill.indexOf("## Schema"), skill.indexOf("## Freezing a good run")).trim();
if (!spec.startsWith("## Schema") || spec.length < 5000) throw new Error("build-single: could not extract the schema from SKILL.md");

// ---- the player: its "Open another playbook" menu item opens the panel here
// The empty data: favicon is dropped: it was the only data: URI in the page, and the artifact's public-sharing review refused a version that embeds a file type it can't read.
const player = patch(patch(read("player.html"), ">Open another playbook<", ">Playbook and chat<", "library menu item"), `<link rel="icon" href="data:,">\n`, "", "empty favicon");

// ---- bundled playbooks, in index order
const index = JSON.parse(read("playbooks/index.json"));
const seeds = index.map((p) => JSON.parse(read("playbooks/" + p.file)));
const DEFAULT_ID = "kafka-load-test-until-it-breaks", EXAMPLE_ID = "kafka-rebalance-storm";   // what the box starts with / what Claude reads as the format example (it has a full Hardcore layer)
for (const id of [DEFAULT_ID, EXAMPLE_ID]) if (!seeds.some((p) => p.meta.id === id)) throw new Error(`build-single: playbook ${id} is not in playbooks/index.json`);

const script = [
  `const PLAYER_HTML = ${inScript(JSON.stringify(player))};`,
  `const SEEDS = ${inScript(JSON.stringify(seeds))};`,
  `const EXAMPLE = SEEDS.find((p) => p.meta.id === ${JSON.stringify(EXAMPLE_ID)});`,
  `const DEFAULT = SEEDS.find((p) => p.meta.id === ${JSON.stringify(DEFAULT_ID)});`,
  `const SPEC = ${inScript(JSON.stringify(spec))};`,
  validatorScope,
  read("sidebar/page.js"),
].join("\n");

const fonts = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">`;
const themeBoot = `<script>try{var t=localStorage.getItem("sim-xp.theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>`;

const page = `<title>sim-xp</title>
<meta name="description" content="Watch a system in motion. Ask Claude for a playbook, then watch it run.">
${fonts}
<style>
${read("sidebar/page.css")}
</style>
${themeBoot}
${read("sidebar/page.html").trim()}
<script type="module">
${script}
</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`${out}  ${(page.length / 1024).toFixed(0)} KB, ${seeds.length} playbooks`);
