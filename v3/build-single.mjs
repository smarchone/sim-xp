#!/usr/bin/env node
// Builds sim-xp into ONE html file: an index of playbooks (the Library, the Local server, Your playground), the player,
// and two bundled playbooks (the rest load from a library). The same file is the GitHub Pages site and what v3/server.js serves
// (where the page also gets its chat with Claude Code).
//   node v3/build-single.mjs [out]        default out: v3/dist/sim-xp.html
// Inlined: player.html (given to the frame as srcdoc), the validator, page/page.{html,css,js}, and the two bundled playbooks from
// playbooks/index.json. Fonts stay on Google Fonts. The file has no <html>/<head>/<body> tags; browsers add them.
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

// ---- the player: its "Open another playbook" button opens the index here
// The empty data: favicon is dropped: the page has no data: URIs.
const player = patch(patch(read("player.html"), ">Open another playbook<", ">← All playbooks<", "library menu item"), `<link rel="icon" href="data:,">\n`, "", "empty favicon");

// ---- bundled playbooks: only the two the page needs to start and to brief Claude. Every other playbook is loaded from a GitHub repo
// (playbooks/index.json is the library's index; the index page fetches it from main).
const index = JSON.parse(read("playbooks/index.json"));
const DEFAULT_ID = "kafka-load-test-until-it-breaks", EXAMPLE_ID = "kafka-rebalance-storm";   // the bundled two: the fallback when a library cannot be reached (the second has a full Hardcore layer)
const seeds = [DEFAULT_ID, EXAMPLE_ID].map((id) => {
  const item = index.find((p) => p.id === id);
  if (!item) throw new Error(`build-single: playbook ${id} is not in playbooks/index.json`);
  return JSON.parse(read("playbooks/" + item.file));
});

const script = [
  `const PLAYER_HTML = ${inScript(JSON.stringify(player))};`,
  `const SEEDS = ${inScript(JSON.stringify(seeds))};`,
  `const DEFAULT = SEEDS.find((p) => p.meta.id === ${JSON.stringify(DEFAULT_ID)});`,
  validatorScope,
  read("page/page.js"),
].join("\n");

const fonts = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Roboto+Mono:wght@400;500&display=swap">`;
const themeBoot = `<script>try{var t=localStorage.getItem("sim-xp.theme")||"dark";if(t!=="system")document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}</script>`;

// the charset comes first: served without one (python -m http.server, a file opened from disk) the browser would guess Latin-1
const page = `<meta charset="utf-8">
<title>sim-xp</title>
<meta name="description" content="Watch a system in motion. Ask Claude for a playbook, then watch it run.">
${fonts}
<style>
${read("page/page.css")}
</style>
${themeBoot}
${read("page/page.html").trim()}
<script type="module">
${script}
</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`${out}  ${(page.length / 1024).toFixed(0)} KB, ${seeds.length} playbooks`);
