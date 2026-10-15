// sim-xp v2 page: a library of playbooks and a player frame. A person picks or drops a playbook; an agent
// (Claude Code through the WebMCP bridge) loads and plays one with the tools in tools.js.
import { validate } from "./playbook.js";
import { buildTools } from "./tools.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), library = $("library");
let index = [];          // bundled playbooks (playbooks/index.json)
let waiters = [];        // pending wait_for calls, resolved by player events

// The player frame reads simxp.current when it boots, and reports back through onPlayerEvent.
const simxp = (window.simxp = {
  current: null,
  source: null,
  showLibrary,
  onPlayerEvent(type, data) {
    if (type === "ready") stage.contentWindow.focus();
    waiters = waiters.filter((w) => !w.match(type, data));
  },
});

const player = () => (simxp.current && stage.contentWindow && stage.contentWindow.player) || null;

function parsePlaybook(input) {
  if (typeof input !== "string") return input;
  try { return JSON.parse(input); } catch (e) { throw new Error(`the playbook is not valid JSON: ${e.message}`); }
}

// Loads a checked playbook into a fresh player frame. Resolves once the player is ready.
function loadPlaybook(pb, source) {
  simxp.current = pb; simxp.source = source;
  const url = new URL(location.href);
  if (source.startsWith("library:")) url.searchParams.set("pb", pb.meta.id); else url.searchParams.delete("pb");
  history.replaceState(null, "", url);
  library.hidden = true; stage.hidden = false;
  document.title = pb.meta.title;
  return new Promise((resolve) => {
    waiters.push({ match: (type) => type === "ready" && (resolve(), true) });
    stage.src = "player.html?" + encodeURIComponent(pb.meta.id) + "&" + Date.now();
  });
}

function showLibrary() {
  simxp.current = null; simxp.source = null;
  stage.hidden = true; stage.removeAttribute("src"); library.hidden = false;
  const url = new URL(location.href); url.searchParams.delete("pb"); history.replaceState(null, "", url);
  document.title = "sim-xp";
}

async function fetchBundled(id) {
  const item = index.find((p) => p.id === id);
  if (!item) throw new Error(`no bundled playbook "${id}"; bundled: ${index.map((p) => p.id).join(", ")}`);
  const res = await fetch("playbooks/" + item.file);
  if (!res.ok) throw new Error(`could not fetch playbooks/${item.file} (${res.status})`);
  return res.json();
}

// ---------- library UI ----------
function showError(title, list) {
  const box = $("error");
  box.innerHTML = `<b></b>${list && list.length ? "<ul></ul>" : ""}`;
  box.querySelector("b").textContent = title;
  for (const e of list || []) { const li = document.createElement("li"); li.textContent = e; box.querySelector("ul").append(li); }
  box.hidden = false;
}

async function openFromText(text, name) {
  $("error").hidden = true;
  let pb;
  try { pb = parsePlaybook(text); } catch (e) { return showError(`${name}: ${e.message}`); }
  const r = validate(pb);
  if (!r.ok) return showError(`${name} has ${r.errors.length} problem(s) to fix before it can play:`, r.errors);
  loadPlaybook(pb, "file:" + name);
}

function renderCards() {
  const ul = $("cards"); ul.replaceChildren();
  for (const p of index) {
    const li = document.createElement("li"), b = document.createElement("button");
    b.className = "card";
    b.innerHTML = `<b></b><p></p><span class="meta"></span>`;
    b.querySelector("b").textContent = p.title;
    b.querySelector("p").textContent = p.story;
    const meta = b.querySelector(".meta");
    for (const t of [`${Math.round(p.duration_s / 60)} min`, `${p.key_moments} key moments`, ...p.tags.slice(0, 3)]) { const s = document.createElement("span"); s.textContent = t; meta.append(s); }
    b.onclick = async () => { try { loadPlaybook(await fetchBundled(p.id), "library:" + p.id); } catch (e) { showError(e.message); } };
    li.append(b); ul.append(li);
  }
}

$("file").onchange = async (e) => { const f = e.target.files[0]; if (f) openFromText(await f.text(), f.name); e.target.value = ""; };
let dragDepth = 0;
addEventListener("dragenter", (e) => { if (!library.hidden && [...e.dataTransfer.types].includes("Files")) { dragDepth++; $("drop").hidden = false; } });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", async (e) => {
  e.preventDefault(); dragDepth = 0; $("drop").hidden = true;
  const f = e.dataTransfer.files[0]; if (f) openFromText(await f.text(), f.name);
});
document.querySelectorAll("[data-copy]").forEach((b) => {
  b.onclick = async () => {
    const code = $(b.dataset.copy);
    try { await navigator.clipboard.writeText(code.textContent); b.textContent = "Copied"; } catch (err) { getSelection().selectAllChildren(code); b.textContent = "Selected"; }
    setTimeout(() => (b.textContent = "Copy"), 1500);
  };
});

// ---------- start ----------
try { index = await (await fetch("playbooks/index.json")).json(); } catch (e) { index = []; showError("Could not load the bundled playbooks. Serve this folder over http."); }
renderCards();
const want = new URLSearchParams(location.search).get("pb");
if (want) { try { loadPlaybook(await fetchBundled(want), "library:" + want); } catch (e) { showError(e.message); } }

// ---------- WebMCP ----------
const tools = buildTools({
  index: () => index, fetchBundled, parsePlaybook, loadPlaybook, showLibrary, player, simxp,
  waitFor(match, timeoutMs) {
    return new Promise((resolve) => {
      const w = { match: (type, data) => match(type, data) && (clearTimeout(timer), resolve({ event: type, ...data }), true) };
      const timer = setTimeout(() => { waiters = waiters.filter((x) => x !== w); resolve({ event: "timeout" }); }, timeoutMs);
      waiters.push(w);
    });
  },
});
if ("modelContext" in document) {
  Promise.all(tools.map((t) => document.modelContext.registerTool(t)))
    .then(() => { $("webmcp").textContent = `${tools.length} WebMCP tools ready`; $("webmcp").classList.add("on"); })
    .catch((err) => ($("webmcp").textContent = `WebMCP error: ${err.message}`));
} else {
  $("webmcp").textContent = "no WebMCP in this browser";
}
