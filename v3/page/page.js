// sim-xp as an artifact: an index of playbooks (the Library: GitHub repos, and Your playground with + Add your own), and the player, which fills the
// window once one is picked. A chat bar asks Claude (the viewer's own Claude, through the `sample`
// capability) to write a playbook into the playbook box; Run plays whatever is in the box.
// Globals the build adds above this file: PLAYER_HTML, SEEDS (the two bundled playbooks: the default and the format example; every other playbook is loaded from a GitHub repo on demand), EXAMPLE (the format reference Claude reads), DEFAULT (the fallback playbook),
// SPEC (the format and authoring rules), __playbook (the validator).
const { validate } = __playbook;
const $ = (id) => document.getElementById(id);
const stage = $("stage"), pbBox = $("pb"), logEl = $("log"), statusEl = $("status"), problemsEl = $("problems");
const askEl = $("ask"), sendBtn = $("send"), stopBtn = $("stop"), runBtn = $("runBtn");

// ---------- player frame (the player reads simxp.current when it boots and reports back through onPlayerEvent) ----------
const simxp = (window.simxp = {
  current: null,
  source: null,
  showLibrary() { showIndex(); },
  onPlayerEvent(type) { if (type === "ready") stage.contentWindow.focus(); },
});
const LAST = "sim-xp.last";   // the playbook played last, reopened on the next visit
function play(pb, src = null) {   // src: the library source (key) the playbook came from, when it was loaded from a repo
  if (!src && SEEDS.some((x) => JSON.stringify(x) === JSON.stringify(pb))) src = DEFAULT_SRC;   // the two bundled playbooks are copies of the default repo's
  simxp.current = pb; simxp.source = "box"; simxp.src = src;
  // a library playbook's recorded narration, if it has one, sits next to it in <library folder>/audio/<id>/ (v3/tools/gen-audio.mjs)
  const lib = src && sources.get(src);
  simxp.audio = lib ? lib.base + "/audio/" + encodeURIComponent(pb.meta.id) + "/" : "";
  try { localStorage.setItem(LAST, JSON.stringify(pb)); } catch (e) { /* storage blocked: it starts on the default next time */ }
  stage.srcdoc = PLAYER_HTML + "<!-- " + Date.now() + " -->";
  track(pb); showPlayer();
}
// Mark the run in the address (#<playbook id>) and send a Google Analytics event. Both are best effort: the artifact has no gtag and may not allow history changes.
function track(pb) {
  const id = String(pb.meta.id), src = simxp.src || "";   // #<owner/repo[@ref][/path]>:<id> for a repo playbook (the default repo too), plain #<id> for one in the Saved list
  // from the index it is a new entry, so Back returns to the index
  try { history[document.body.classList.contains("view-index") ? "pushState" : "replaceState"](null, "", "#" + (src ? encodeURI(src) + ":" : "") + encodeURIComponent(id)); } catch (e) { /* not allowed here (artifact frame) */ }
  try { if (typeof window.gtag === "function") window.gtag("event", "playbook_run", { playbook_id: id, playbook_title: pb.meta.title }); } catch (e) { /* analytics blocked */ }
}

// ---------- two views: the index (the start, unless the address names a playbook) and the player ----------
function showPlayer() {
  document.body.className = "view-player"; stage.hidden = false;
  $("drawer").hidden = $("scrim").hidden = true; $("makeBtn").setAttribute("aria-expanded", "false");
  try { stage.contentWindow.focus(); } catch (e) { /* not ready */ }
}
function showIndex(target) {   // target: the id of a section to bring into view
  try { stage.contentWindow.player && stage.contentWindow.player.pause(); } catch (e) { /* no player yet */ }
  document.body.className = "view-index"; stage.hidden = true;
  $("backBtn").hidden = !simxp.current; if (simxp.current) $("backTitle").textContent = simxp.current.meta.title;   // back to the playbook loaded, named
  paintTheme();
  for (const src of sources.values()) if (src.state === "idle") loadIndex(src);
  renderRepos(); renderLibrary();
  if (location.hash) try { history.pushState(null, "", location.pathname + location.search); } catch (e) { /* not allowed here */ }
  if (target === "make") setDrawer(true);
}
// Add your own (the chat and the playbook box) is a drawer over the index, opened from the Your playground heading
function setDrawer(on) {
  $("drawer").hidden = $("scrim").hidden = !on; $("makeBtn").setAttribute("aria-expanded", String(on));
  if (on) ($("ask").disabled ? $("runBtn") : $("ask")).focus(); else $("makeBtn").focus();
}
$("makeBtn").onclick = () => setDrawer($("drawer").hidden);
$("drawerClose").onclick = () => setDrawer(false);
$("scrim").onclick = () => { if (!$("addLib").hidden) setAddDialog(false); else setDrawer(false); };
addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!$("addLib").hidden) setAddDialog(false); else if (!$("drawer").hidden) setDrawer(false); });
$("backBtn").onclick = () => { if (simxp.current) { track(simxp.current); showPlayer(); } };
// theme: the same setting as the player's (sim-xp.theme), kept in step with the player when it is loaded
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
function paintTheme() { const d = isDark(), b = $("themeBtn"); b.textContent = d ? "☀" : "☾"; b.title = b.ariaLabel = d ? "Switch to light theme" : "Switch to dark theme"; }
$("themeBtn").onclick = () => {
  const v = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = v;
  try { localStorage.setItem("sim-xp.theme", v); } catch (e) { /* storage blocked */ }
  try { stage.contentWindow.applyTheme && stage.contentWindow.applyTheme(v, true); } catch (e) { /* no player yet */ }
  paintTheme();
};
// the JSON is out of the way until asked for; problems with it show either way
// the playbook in progress lives in a hidden field (#pb): a file opened, what Claude wrote, or a local playbook
// the skill's install command, copied with one click (selected instead where the clipboard is blocked)
$("copyCmd").onclick = async () => {
  const b = $("copyCmd"), done = (t) => { b.textContent = t; setTimeout(() => (b.textContent = "Copy"), 1600); };
  try { await navigator.clipboard.writeText($("skillCmd").textContent); done("Copied"); }
  catch (e) { const r = document.createRange(); r.selectNodeContents($("skillCmd")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); done("Press ⌘C"); }
};
// a message about the playbook (loaded, kept, could not load) at the top of the drawer; the chat keeps its own
function note(text) { $("note").textContent = text || ""; $("note").hidden = !text; }

// ---------- the playbook box ----------
function check(text) {
  if (!text.trim()) return { empty: true, errors: [], warnings: [] };
  let pb;
  try { pb = JSON.parse(text); } catch (e) { return { errors: [`this is not valid JSON: ${e.message}`], warnings: [] }; }
  const r = validate(pb);
  return { pb, errors: r.errors, warnings: r.warnings };
}
let last = check("");
function refresh() {
  last = check(pbBox.value);
  problemsEl.replaceChildren();
  statusEl.className = "status";
  statusEl.title = "";
  if (last.empty) statusEl.textContent = "";
  else if (last.errors.length) {
    statusEl.textContent = `✕ ${last.errors.length} problem${last.errors.length === 1 ? "" : "s"} to fix`; statusEl.classList.add("bad");
    for (const e of last.errors) { const li = document.createElement("li"); li.textContent = e; problemsEl.append(li); }
  } else {
    statusEl.textContent = "✓ Ready to play"; statusEl.classList.add("ok");
    statusEl.title = last.warnings.join("\n");
  }
  problemsEl.hidden = !problemsEl.children.length;
  $("boxNote").textContent = last.pb && last.pb.meta && last.pb.meta.title ? last.pb.meta.title : last.errors.length ? "This is not a playbook yet." : "";
  $("result").hidden = last.empty || !added;
  const ok = !last.empty && !last.errors.length;
  runBtn.disabled = !ok;
}
let t = 0;
pbBox.addEventListener("input", () => { clearTimeout(t); t = setTimeout(refresh, 300); });
// added: the playbook came from this drawer (a file loaded, or what Claude wrote). Only then does the drawer show it; a playbook
// picked from a library is held here too (to play it, and for Claude to change), but it is not "yours" to show.
let added = false;
function setBox(text, own = false) { added = own; pbBox.value = text; refresh(); }

function run() {
  refresh();
  if (last.empty || last.errors.length) return;
  const fromRepo = repoLoaded && repoLoaded.text === pbBox.value;   // a repo playbook stays in its repo; only what the person wrote or edited is saved
  if (!fromRepo && repoLoaded && last.pb.meta.id === repoLoaded.id) {   // an edited copy never takes the repo playbook's id: its link and Saved entry stay its own
    let id = repoLoaded.id + "-copy", n = 2;
    while (library.has(docId({ meta: { id } }))) id = `${repoLoaded.id}-copy-${n++}`;
    last.pb.meta.id = id; setBox(JSON.stringify(last.pb, null, 2), added);
  }
  play(last.pb, fromRepo ? repoLoaded.src : null);
  if (!fromRepo && last.pb.meta.id !== DEFAULT.meta.id) saveToLibrary(last.pb);
}
runBtn.onclick = run;

// ---------- saved playbooks: this browser's storage, at most 20, per artifact and per device ----------
const savedEl = $("saved"), savedList = $("savedList"), MAX_SAVED = 20, LIB = "sim-xp.playbooks";
const library = new Map();   // id -> { title, story, duration_s, beats, updated, json }, newest first
const anchorSave = async ({ filename, data }) => {   // outside the Claude artifact an ordinary download works
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" })), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
let storageOk = true, downloads = window.claude ? null : { save: anchorSave };
try { for (const [id, x] of JSON.parse(localStorage.getItem(LIB) || "[]")) if (x && typeof x.json === "string") library.set(id, x); } catch (e) { storageOk = false; }
function persist() {
  try { localStorage.setItem(LIB, JSON.stringify([...library])); return true; }
  catch (e) { note("This browser would not keep it. It still plays now."); return false; }
}
const docId = (pb) => "pb_" + String(pb.meta.id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
const entryOf = (pb, updated) => ({ title: pb.meta.title, story: pb.meta.story, duration_s: pb.meta.duration_s, beats: (pb.timeline || []).filter((e) => e.beat).length, updated, json: JSON.stringify(pb) });
function saveToLibrary(pb) {
  if (!storageOk) return false;
  const json = JSON.stringify(pb), id = docId(pb), old = library.get(id);
  if (old && old.json === json) return true;
  if (!old && library.size >= MAX_SAVED) { note(`Your playground holds ${MAX_SAVED} playbooks. Delete one to keep this one.`); return false; }
  const entry = entryOf(pb, Date.now());
  const before = new Map(library);
  library.delete(id);
  const next = new Map([[id, entry], ...library]);   // newest first
  library.clear(); for (const [k, v] of next) library.set(k, v);
  if (!persist()) { library.clear(); for (const [k, v] of before) library.set(k, v); return false; }
  renderLibrary();
  return true;
}
const fmtMin = (s) => s ? `${Math.max(1, Math.round(s / 60))} min` : "";
// a playbook in the list, like a post on a blog's front page: the title and a quiet line of facts (the story on hover)
function card(title, story, meta, onPlay, now) {
  const li = document.createElement("li"), btn = document.createElement("button"), b = document.createElement("b");
  btn.className = "post"; btn.setAttribute("aria-label", "Play " + title);
  b.textContent = title; btn.append(b);
  if (story) btn.title = story;   // the story shows on hover; the list itself is titles only
  const m = document.createElement("span"); m.className = "meta"; m.textContent = meta.filter(Boolean).join(" · ");
  if (now) { const n = document.createElement("span"); n.className = "now-tag"; n.textContent = "playing now"; m.prepend(n); }
  btn.append(m); btn.onclick = onPlay; li.append(btn);
  return li;
}
const isNow = (id, src) => !!simxp.current && simxp.current.meta.id === id && (simxp.src || null) === (src || null);
function renderLibrary() {
  savedList.replaceChildren(); if (navReady) renderNav();
  $("savedCount").textContent = library.size ? `· ${library.size} of ${MAX_SAVED}` : "";
  if (!library.size) { const li = document.createElement("li"); li.className = "empty"; li.textContent = storageOk ? "Nothing yet. Playbooks you write with Claude or open from a file are kept here." : "This browser keeps nothing, so playbooks you add play but are not kept."; savedList.append(li); return; }
  for (const [id, x] of library) {
    const load = () => { try { setBox(JSON.stringify(JSON.parse(x.json), null, 2)); repoLoaded = null; return true; } catch (e) { note("That local playbook could not be read."); return false; } };
    const li = card(x.title || id, x.story, [fmtMin(x.duration_s), `${x.beats || 0} key moments`], () => { if (load()) run(); }, isNow(id.replace(/^pb_/, ""), null));
    { const w = document.createElement("span"); w.className = "when"; w.textContent = "saved " + new Date(x.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · "; li.querySelector(".meta").prepend(w); }
    const acts = document.createElement("div"); acts.className = "acts";
    const tl = (b) => { b.className = "tlink"; return b; };
    if (downloads) {
      const ex = tl(document.createElement("button"));
      ex.textContent = "Export"; ex.title = "Export as a .json file"; ex.setAttribute("aria-label", "Export " + (x.title || id));
      ex.onclick = async () => { try { await downloads.save({ filename: id.replace(/^pb_/, "") + ".json", data: JSON.stringify(JSON.parse(x.json), null, 2) }); } catch (e) { note("The file was not saved."); } };
      acts.append(ex);
    }
    const del = tl(document.createElement("button"));
    del.textContent = "Delete"; del.title = "Delete from this browser"; del.setAttribute("aria-label", "Delete " + (x.title || id));
    del.onclick = () => {
      if (del.dataset.sure) { library.delete(id); persist(); renderLibrary(); return; }
      del.dataset.sure = "1"; del.textContent = "Delete?"; setTimeout(() => { del.dataset.sure = ""; del.textContent = "Delete"; }, 3000);
    };
    acts.append(del); li.append(acts); savedList.append(li);
  }
}
var navReady = false;   // the sidebar is drawn once the repos are known (below)
renderLibrary();

// ---------- library: playbooks loaded from GitHub repos, on demand ----------
// A source is a folder of playbook .json files plus an index.json listing them (format in v3/README.md). The panel fetches the index when
// the Library is opened and a playbook only when it is clicked; nothing from a repo is copied into storage. Only the list of added repos is kept.
// The default library is this repo's v3/playbooks folder (with its audio/), read from GitHub, so the site, the artifact and a copy
// opened from disk all list the same playbooks. It used to be the smarchone/simxp-playbooks repo; links naming it open the same playbook here.
const DEFAULT_SRC = "smarchone/sim-xp@main/v3/playbooks", LEGACY_SRC = "smarchone/simxp-playbooks", SRCS = "sim-xp.repos", CACHE = "sim-xp.cache", TTL = 7 * 24 * 3600 * 1000, CACHE_MAX = 20;
// Fetched playbooks are kept for a week, apart from the Saved list; an index.json is always fetched fresh. Newest 20 entries stay; a blocked or full storage just means no cache.
function cacheGet(key) {
  try { const e = JSON.parse(localStorage.getItem(CACHE) || "{}")[key]; return e && Date.now() - e.t < TTL ? e.v : null; } catch (err) { return null; }
}
function cachePut(key, v) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || "{}");
    all[key] = { t: Date.now(), v };
    const keep = Object.entries(all).filter(([, e]) => Date.now() - e.t < TTL).sort((a, b) => b[1].t - a[1].t).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE, JSON.stringify(Object.fromEntries(keep)));
  } catch (err) { /* storage blocked or full: no cache */ }
}
async function getJson(url, keep) {   // keep: a copy is kept for a week and used next time; without it the browser revalidates every time
  const hit = keep ? cacheGet(url) : null;
  if (hit) return hit;
  const res = await fetch(url, keep ? undefined : { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status === 404 ? "not found" : "GitHub answered " + res.status);
  const j = await res.json();
  if (keep) cachePut(url, j);
  return j;
}
function parseSrc(text) {   // "owner/repo", "owner/repo@ref", "owner/repo@ref/dir", or a github.com link (…/tree/<ref>/<dir>)
  let t = String(text).trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git(?=$|\/|@)/, "").replace(/\/+$/, "");
  const tree = t.match(/^([\w.-]+)\/([\w.-]+)\/tree\/([\w.-]+)(?:\/(.*))?$/);
  if (tree) t = `${tree[1]}/${tree[2]}@${tree[3]}` + (tree[4] ? "/" + tree[4] : "");
  const m = t.match(/^([\w.-]+)\/([\w.-]+?)(?:@([\w.-]+))?(?:\/([\w./-]+))?$/);
  if (!m || (m[4] || "").split("/").includes("..")) return null;
  const [, owner, repo, ref = "HEAD", dir = ""] = m;
  return { key: `${owner}/${repo}` + (m[3] ? "@" + ref : "") + (dir ? "/" + dir : ""), base: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}` + (dir ? "/" + dir : ""),
    html: `https://github.com/${owner}/${repo}` + (m[3] || dir ? `/tree/${ref}` + (dir ? "/" + dir : "") : "") };
}
const sources = new Map();   // key -> { key, base, items, state: "idle" | "loading" | "ok" | "err", error, promise }
function addSource(text) {
  if (sources.has(text)) return sources.get(text);   // e.g. the local server's library, which is not a GitHub repo
  const p = parseSrc(text);
  if (!p) return null;
  if (!sources.has(p.key)) sources.set(p.key, { ...p, items: [], state: "idle", error: "" });
  return sources.get(p.key);
}
const userSources = () => [...sources.keys()].filter((k) => k !== DEFAULT_SRC && k !== LOCAL_SRC);
function saveSources() { try { localStorage.setItem(SRCS, JSON.stringify(userSources())); } catch (e) { /* storage blocked: added repos last this visit only */ } }
addSource(DEFAULT_SRC);
// Served by a local server (e.g. `npx serve .` or `python3 -m http.server` from the repo or v3/), the page also lists v3/playbooks, the folder
// next to dist/, as "Local server": read fresh every time (no cache), so a playbook being written shows its latest save. Not listed when that folder
// cannot be reached (the server's root does not include it); never on GitHub Pages, from disk, or in the Claude artifact.
const LOCAL_SRC = "local";
const LOCAL_BASE = /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname)
  ? new URL("../playbooks", location.href).href : null;
if (LOCAL_BASE) sources.set(LOCAL_SRC, { key: LOCAL_SRC, base: LOCAL_BASE, html: "", local: true, items: [], state: "idle", error: "" });
try { for (const k of JSON.parse(localStorage.getItem(SRCS) || "[]")) if (typeof k === "string") addSource(k); } catch (e) { /* none stored */ }
const goodItem = (x) => x && typeof x === "object" && ["id", "file", "title"].every((k) => typeof x[k] === "string" && x[k]) && /^[\w.-]+(\/[\w.-]+)*\.json$/.test(x.file) && !x.file.split("/").includes("..");
function loadIndex(src, again = false) {   // one fetch per source per visit until it fails; again fetches it once more
  if (src.promise && !again) return src.promise;
  src.state = "loading"; renderRepos();
  src.promise = (async () => {
    try {
      const j = await getJson(src.base + "/index.json").catch((e) => { throw new Error(e.message === "not found" ? "no index.json in that folder" : e.message); });
      const list = Array.isArray(j) ? j : j && Array.isArray(j.playbooks) ? j.playbooks : null;
      if (!list) throw new Error("index.json must be a list of playbooks");
      src.items = list.filter(goodItem); src.state = "ok";
    } catch (e) { src.state = "err"; src.error = e instanceof SyntaxError ? "index.json is not valid JSON" : e.message || "could not reach GitHub"; src.promise = null; }
    renderRepos(); return src;
  })();
  return src.promise;
}
async function fetchPlaybook(src, item) {
  const pb = await getJson(src.base + "/" + item.file, !src.local).catch((e) => { throw new Error(`${item.file}: ${e.message}`); }), r = validate(pb);
  if (r.errors.length) throw new Error(`${item.file} is not a valid playbook (${r.errors[0]})`);
  return pb;
}
let repoLoaded = null;   // { text, src, id }: what the box holds when it came from a repo unchanged
async function openFromRepo(src, item, andRun) {
  try {
    const pb = await fetchPlaybook(src, item);
    setBox(JSON.stringify(pb, null, 2)); repoLoaded = { text: pbBox.value, src: src.key, id: pb.meta.id };
    if (andRun) run();
  } catch (e) { note("Could not load that playbook: " + (e.message || "network error")); showIndex("make"); }
}
const repoList = $("repoList"), repoIn = $("repoIn");
const label = (src) => src.key === DEFAULT_SRC ? "sim-xp playbooks" : src.local ? "Local server" : src.key;   // the heading of a repo's group (GitHub)
// The sidebar lists the libraries (sim-xp playbooks first, then the repos added, then Your playground); the main column shows the one picked, which is remembered.
const CUR = "sim-xp.lib", SAVED = "saved";
let currentLib = DEFAULT_SRC;
try { const k = localStorage.getItem(CUR); if (k === SAVED || sources.has(k)) currentLib = k; } catch (e) { /* none stored */ }
function selectLib(key) {
  currentLib = key;
  try { localStorage.setItem(CUR, key); } catch (e) { /* storage blocked: this visit only */ }
  const src = sources.get(key); if (src && src.state === "idle") loadIndex(src); else renderRepos();
}
// the GitHub mark, linking to a repo library on github.com
const GH_PATH = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";
function ghLink(src) {
  const a = document.createElement("a"), NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), path = document.createElementNS(NS, "path");
  a.className = "ghlink"; a.href = src.html; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = "Open " + src.key + " on GitHub"; a.setAttribute("aria-label", a.title);
  svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("aria-hidden", "true"); path.setAttribute("d", GH_PATH); path.setAttribute("fill", "currentColor");
  svg.append(path); a.append(svg);
  return a;
}
function renderNav() {
  const nav = $("libNav"); nav.replaceChildren();
  const item = (key, name, count, title, src) => {
    const li = document.createElement("li"), b = document.createElement("button"), n = document.createElement("span"), c = document.createElement("span");
    // a row: the name (the button that picks it), the GitHub mark right after it for a repo, the count at the far end (clicking it picks too)
    b.type = "button"; b.className = "navitem"; b.title = title || name; if (key === currentLib) { b.setAttribute("aria-current", "true"); li.className = "cur"; }
    n.className = "nm"; n.textContent = name; b.append(n); c.className = "nc"; c.textContent = count; c.setAttribute("aria-hidden", "true");
    b.onclick = c.onclick = () => selectLib(key); li.append(b); if (src) li.append(ghLink(src)); li.append(c); nav.append(li);
  };
  for (const src of sources.values()) item(src.key, label(src), src.state === "ok" ? String(src.items.length) : src.state === "loading" ? "…" : src.state === "err" ? "!" : "", src.local ? "v3/playbooks on this server" : src.key, src.local ? null : src);
  item(SAVED, "Your playground", library.size ? String(library.size) : "", "Playbooks kept in this browser");
  savedEl.hidden = currentLib !== SAVED;
}
// the default one falls back to the two bundled playbooks when GitHub cannot be reached
function renderRepos() {
  repoList.replaceChildren(); renderNav();
  for (const src of sources.values()) {
    if (src.key !== currentLib) continue;
    const g = document.createElement("section"), h = document.createElement("h2"), st = document.createElement("span"), ul = document.createElement("ul");
    g.className = "group"; h.className = "lhead"; h.title = src.key; st.className = "st";
    h.append(label(src));
    st.textContent = src.state === "loading" ? "loading…" : src.state === "err" ? src.error : src.state === "ok" ? `${src.items.length}` : "";
    if (src.state === "err") st.classList.add("bad");
    if (!src.local) h.append(ghLink(src));
    h.append(st);
    const again = document.createElement("button");
    again.className = "tlink"; again.textContent = "↻"; again.title = "Fetch the list again"; again.setAttribute("aria-label", "Refresh " + label(src)); again.onclick = () => loadIndex(src, true);
    h.append(again); { const sp = document.createElement("span"); sp.className = "spacer"; h.append(sp); }
    if (src.key !== DEFAULT_SRC && !src.local) {
      const del = document.createElement("button");
      del.className = "tlink"; del.textContent = "remove"; del.title = "Remove this repo"; del.setAttribute("aria-label", "Remove " + src.key);
      del.onclick = () => { sources.delete(src.key); saveSources(); selectLib(DEFAULT_SRC); };
      h.append(del);
    }
    ul.className = "posts";
    if (src.state === "loading" && !src.items.length) for (let i = 0; i < 3; i++) { const li = document.createElement("li"); li.className = "skel"; li.setAttribute("aria-hidden", "true"); ul.append(li); }
    for (const item of src.items) ul.append(card(item.title, item.story, [fmtMin(item.duration_s), item.key_moments ? `${item.key_moments} key moments` : "", ...(Array.isArray(item.tags) ? item.tags.slice(0, 2) : [])], () => openFromRepo(src, item, true), isNow(item.id, src.key)));
    if (src.state === "err" && src.key === DEFAULT_SRC) for (const pb of SEEDS) ul.append(card(pb.meta.title, pb.meta.story, [fmtMin(pb.meta.duration_s), `${(pb.timeline || []).filter((e) => e.beat).length} key moments`, "bundled"], () => { setBox(JSON.stringify(pb, null, 2)); repoLoaded = null; play(pb); }, isNow(pb.meta.id, DEFAULT_SRC)));
    if (src.state === "ok" && !src.items.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "No playbooks listed in its index.json."; ul.append(li); }
    g.append(h, ul); repoList.append(g);
  }
}
navReady = true;
renderRepos();
// the local library shows only once its index.json has answered; if it cannot be reached it is dropped, quietly
if (LOCAL_BASE) loadIndex(sources.get(LOCAL_SRC)).then((src) => {
  if (src.state === "ok") return;
  sources.delete(LOCAL_SRC);
  if (currentLib === LOCAL_SRC) selectLib(DEFAULT_SRC); else renderRepos();
});
// adding a library: a small dialog with what a library is, the GitHub link, the other forms it takes, and a problem shown in place
function repoError(text) { $("repoErr").textContent = text; $("repoErr").hidden = !text; }
function addRepoFromInput() {
  if (!repoIn.value.trim()) { repoError("Paste a GitHub link first."); repoIn.focus(); return; }
  const src = addSource(repoIn.value);
  if (!src) { repoError("That is not a GitHub repo link. Paste a link like https://github.com/owner/repo, or write owner/repo."); repoIn.focus(); return; }
  saveSources(); setAddDialog(false); selectLib(src.key); loadIndex(src, true);
}
function setAddDialog(on) {
  $("addLib").hidden = $("scrim").hidden = !on; repoError("");
  if (on) { repoIn.value = ""; repoIn.focus(); } else $("addLibBtn").focus();
}
$("addLibBtn").onclick = () => setAddDialog(true);
$("repoAdd").onclick = addRepoFromInput;
$("repoCancel").onclick = () => setAddDialog(false);
repoIn.addEventListener("input", () => repoError(""));
repoIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addRepoFromInput(); } });

// ---------- files in and out ----------
async function openText(text, name) {
  setBox(text, true);
  note(`Opened ${name}.`);
  showIndex("make");
}
$("file").onchange = async (e) => { const f = e.target.files[0]; if (f) openText(await f.text(), f.name); e.target.value = ""; };
let depth = 0;
addEventListener("dragenter", (e) => { if ([...e.dataTransfer.types].includes("Files")) { depth++; $("drop").hidden = false; } });
addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("drop").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", async (e) => { e.preventDefault(); depth = 0; $("drop").hidden = true; const f = e.dataTransfer.files[0]; if (f) openText(await f.text(), f.name); });
(async () => {
  if (window.claude) { try { downloads = await window.claude.use("downloads"); } catch (e) { /* not available */ } }
  if (!downloads) return;
  renderLibrary();   // local playbooks get Export
})();

// ---------- chat ----------
function say(kind, text) {
  const li = document.createElement("li"), d = document.createElement("div");
  d.className = "msg " + kind; d.textContent = text; li.append(d); logEl.append(li);
  logEl.scrollTop = logEl.scrollHeight;
  return d;
}
const HELLO = say("claude", "");
HELLO.classList.add("hello");
HELLO.innerHTML = "Tell Claude what to simulate, for example <i>a cache stampede after a deploy</i>. It writes the playbook; then press <b>Play</b>. Ask again to change it.";

const PREAMBLE = `You write playbooks for sim-xp, a player that animates a scripted, deterministic run of a small system: components light up, charts move, a feed scrolls, and playback pauses at key moments. A person chats with you. Each playbook you write goes straight into a box on the page, is checked by a validator, and the person presses Run to watch it.

How to reply:
- If the person asks for a playbook, or a change to the one in the box: reply with one or two plain sentences (what the story is, and anything you invented), then the COMPLETE playbook as ONE \`\`\`json code fence of compact JSON (no indentation, to keep it short), and nothing after the fence. Never send a patch, always the whole playbook.
- If they ask a question about the format or the story: answer briefly in plain text and write no playbook.
- Keep it complete rather than long. Skip the optional Hardcore layer (items tagged "deep"), report.math, report.myths and report.links unless the person asks for them or the story needs them. 8 to 10 dashboard panels, 8 to 12 metrics, 10 to 16 feed lines, 4 to 7 key moments.
- You cannot run the validator yourself. Be careful with ids (every id referenced must exist), times (integers from 0 to duration_s, timeline sorted) and arithmetic (a backlog grows at in minus out). When the message lists validator problems, fix them all and return the whole playbook.

The reference follows. Ignore its mentions of files, scripts and the Claude Code workflow; the box and the page replace them.`;
const SYSTEM = PREAMBLE + "\n\n" + SPEC + "\n\nExample of a complete, valid playbook (compact):\n```json\n" + JSON.stringify(EXAMPLE) + "\n```";

let sample = null, busy = false, ctl = null, turns = [];
const COPY = {
  not_granted: "Claude is not allowed for this page. Allow it when asked, or open or paste a playbook instead.",
  rate_limited: "Too many requests, or your Claude usage limit is reached. Try again later.",
  session_expired: "Your session expired. Sign in to Claude again, then retry.",
  refused: "Claude declined that request. Try asking for something different.",
  empty_completion: "Claude sent nothing back. Try again with a bit more detail.",
  prompt_too_large: "The current playbook is too large to send along. Reload the page and ask again.",
};
function setBusy(on) {
  busy = on; sendBtn.hidden = on; stopBtn.hidden = !on; askEl.disabled = on || !sample;
  runBtn.disabled = on || runBtn.disabled; pbBox.readOnly = on;
  if (!on) refresh();
}
const fence = (text) => {
  const i = text.indexOf("```json");
  if (i < 0) return { note: text.trim(), code: null, closed: false };
  const rest = text.slice(i + 7).replace(/^\s*\n/, ""), j = rest.indexOf("```");
  return { note: text.slice(0, i).trim(), code: j < 0 ? rest : rest.slice(0, j), closed: j >= 0 };
};

async function send(text) {
  text = text.trim();
  if (busy || !sample || !text) return;
  setBusy(true); askEl.value = "";
  say("me", text);
  const prev = pbBox.value, cur = prev.trim();
  let state = "The box is empty.";
  if (cur) {
    let body = cur; try { body = JSON.stringify(JSON.parse(cur)); } catch (e) { /* send as typed */ }
    state = "The playbook in the box now:\n" + body;
    const r = check(cur);
    if (r.errors.length) state += "\n\nValidator problems with it:\n- " + r.errors.join("\n- ");
  }
  const bubble = say("claude", "Thinking…");
  ctl = new AbortController();
  let wrote = false;
  try {
    const res = await sample(
      [{ role: "user", content: SYSTEM }, ...turns.slice(-6), { role: "user", content: text + "\n\n---\n" + state }],
      {
        cache: false, signal: ctl.signal,
        onText: ({ text: t }) => {
          const f = fence(t);
          bubble.textContent = f.note || (f.code == null ? t : "Writing the playbook…");
          if (f.code != null) { wrote = true; pbBox.value = f.code; pbBox.scrollTop = pbBox.scrollHeight; statusEl.className = "status"; statusEl.textContent = `Claude is writing… ${Math.round(f.code.length / 1024)} KB`; }
          logEl.scrollTop = logEl.scrollHeight;
        },
      });
    const f = fence(res.text);
    bubble.textContent = f.note || (f.code == null ? res.text : "Done.");
    turns.push({ role: "user", content: text }, { role: "assistant", content: (f.note || res.text) + (f.code != null ? " [playbook written to the box]" : "") });
    if (f.code == null) { setBusy(false); return; }
    let out = f.code.trim();
    try { out = JSON.stringify(JSON.parse(out), null, 2); } catch (e) { /* leave as written; the box shows the problem */ }
    setBusy(false); setBox(out, true);
    if (res.truncated) say("err", "Claude hit its length limit and the playbook is cut off. Ask for a shorter one, for example fewer feed lines and charts.");
    else if (last.errors.length) {
      const m = say("err", `The playbook has ${last.errors.length} problem${last.errors.length === 1 ? "" : "s"} (listed below).`);
      const b = document.createElement("button"); b.textContent = "Ask Claude to fix them"; b.onclick = () => { b.remove(); send("Fix the validator problems and return the whole playbook."); }; m.append(b);
    } else {
      const kept = await saveToLibrary(last.pb);
      say("note", `${last.pb.meta.title} is ready${kept ? " and kept in Your playground" : ""}. Press Play below.`);
      runBtn.focus();
    }
  } catch (e) {
    if (wrote) { pbBox.value = prev; }
    setBusy(false); refresh();
    if (e && e.code === "cancelled") bubble.textContent = "Stopped. Your playbook is as it was.";
    else { bubble.remove(); say("err", COPY[e && e.code] || "Something went wrong talking to Claude. Your playbook is as it was; try again."); }
  } finally { ctl = null; }
}
// a <form> would be blocked by the artifact sandbox, so Send and Enter are plain handlers
sendBtn.onclick = () => send(askEl.value);
askEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(askEl.value); } });
stopBtn.onclick = () => ctl && ctl.abort();

// ---------- start ----------
// The address names a playbook as #<id> (the saved copy, else a bundled one, else the one with that id in a repo) or #<repo>:<id>.
function hashTarget() {
  let h = ""; try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { return null; }
  if (!h) return null;
  const i = h.indexOf(":");
  const src = i > 0 ? h.slice(0, i) : null;
  return { src: src === LEGACY_SRC ? DEFAULT_SRC : src, id: i > 0 ? h.slice(i + 1) : h };
}
function playbookFromHash() {   // what is already here: #<id> is the saved copy, else a bundled one (older links); #<default repo>:<id> is the bundled copy, with no fetch
  const t = hashTarget();
  if (!t || (t.src && t.src !== DEFAULT_SRC)) return null;
  let pb = null;
  if (!t.src) {
    const saved = library.get(docId({ meta: { id: t.id } }));
    try { pb = saved ? JSON.parse(saved.json) : null; } catch (e) { /* unreadable saved copy */ }
  }
  pb = pb || SEEDS.find((s) => s.meta.id === t.id) || null;
  return pb && !validate(pb).errors.length ? pb : null;
}
async function playFromRepoHash(t) {   // a repo playbook: the named repo, else the default one, then the repos added here
  const wanted = t.src ? addSource(t.src) : null;
  if (t.src && !wanted) return;
  for (const src of wanted ? [wanted] : sources.values()) {
    await loadIndex(src);
    const item = src.items.find((x) => x.id === t.id);
    if (item) { await openFromRepo(src, item, true); return; }
  }
}
function openHash() {
  const t = hashTarget();
  if (!t) { if (document.body.classList.contains("view-player")) showIndex(); return; }
  if (simxp.current && simxp.current.meta.id === t.id && (t.src || null) === (simxp.src || null)) { showPlayer(); return; }
  const pb = playbookFromHash();
  if (pb) { setBox(JSON.stringify(pb, null, 2)); repoLoaded = null; play(last.pb); } else playFromRepoHash(t);
}
window.addEventListener("popstate", openHash);   // Back, Forward, or the person edited the address (popstate fires for both)
// Start: a playbook named in the address plays (saved or bundled at once, else fetched from its repo); otherwise the index.
{
  const t = hashTarget(), here = playbookFromHash();
  setBox(here ? JSON.stringify(here, null, 2) : "");   // the editor starts empty unless the address named a playbook
  if (here) play(here);
  else { showIndex(); if (t) playFromRepoHash(t); }
}
(async () => {
  try { sample = await window.claude?.use?.("sample"); } catch (e) { sample = null; }
  if (!sample) {
    askEl.disabled = true; sendBtn.disabled = true; $("bar").hidden = true;
    $("chat").classList.add("off");
    HELLO.className = "msg note"; HELLO.innerHTML = 'In Claude Code, ask for a playbook of your story, for example:<span class="eg">“Make a sim-xp playbook: a cache stampede after a deploy takes the database down.”</span>Claude saves it as a <code>.json</code> file.';
  }
  else { askEl.disabled = busy; $("wayInstall").hidden = true; }   // in the Claude artifact the chat writes playbooks, no skill to install
})();

// the sim-xp name in the header: back to the top of the index (a new tab with a modifier key, as a link)
$("brandHome").onclick = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); showIndex(); try { scrollTo({ top: 0 }); } catch (err) { /* old browser */ } };
