// sim-xp: an index of playbooks (the Library: GitHub repos, the Local server, and Your playground with + Add your own), and the
// player, which fills the window once one is picked. Served by v3/server.js, the page also has a chat with a Claude Code worker
// that writes playbooks into v3/playbooks (see "local server" below); on GitHub Pages there is no chat.
// Globals the build adds above this file: PLAYER_HTML, SEEDS (the two bundled playbooks: every other playbook is loaded from a
// library on demand), DEFAULT (the fallback playbook), __playbook (the validator).
const { validate } = __playbook;
const $ = (id) => document.getElementById(id);
const stage = $("stage"), pbBox = $("pb"), statusEl = $("status"), problemsEl = $("problems");
const runBtn = $("runBtn");

// ---------- player frame (the player reads simxp.current when it boots and reports back through onPlayerEvent) ----------
const simxp = (window.simxp = {
  current: null,
  source: null,
  showLibrary() { showIndex(); },
  chat: null,      // the local server's chat, when the page is served by v3/server.js (see "local server" below)
  restore: null,   // where the player was before a playbook reload (the same place is restored when it is ready)
  onPlayerEvent(type) {
    if (type !== "ready") return;
    stage.contentWindow.focus();
    if (simxp.restore) { const r = simxp.restore; simxp.restore = null; try { stage.contentWindow.player.restore(r); } catch (e) { /* an older player */ } }
  },
});
let LCHAT = null;   // the index's chat under Local server (built once the server answers)
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
// Mark the run in the address (#<playbook id>) and send a Google Analytics event. Both are best effort: a local copy has no gtag and may not allow history changes.
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
  if (on) $("drawerClose").focus(); else $("makeBtn").focus();
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

// ---------- saved playbooks: this browser's storage, at most 20, per site and per device ----------
const savedEl = $("saved"), savedList = $("savedList"), MAX_SAVED = 20, LIB = "sim-xp.playbooks";
const library = new Map();   // id -> { title, story, duration_s, beats, updated, json }, newest first
const anchorSave = async ({ filename, data }) => {   // an ordinary download
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" })), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
let storageOk = true, downloads = { save: anchorSave };
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
// The default library is this repo's v3/playbooks folder (with its audio/), read from GitHub, so the site, the local server and a copy
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
// cannot be reached (the server's root does not include it); never on GitHub Pages or from disk.
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
    g.append(h, ...(src.local && LCHAT ? [LCHAT.el] : []), ul); repoList.append(g);
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

// ---------- local server: a chat with a Claude Code worker (v3/server.js, /simxp) ----------
// Only when the page is served by sim-xp's own server (it answers /api/health); GitHub Pages, a plain static server or a file
// opened from disk have no chat. The page holds the one connection (server-sent events) and lends it to the player as
// simxp.chat: the index's chat makes new playbooks (thread "new"), the player's chat changes the open one (thread = its id).
// When a playbook file changes, the Local server list reloads, and so does the player if that playbook is open, at the same place.
const API = LOCAL_BASE ? new URL("/api/", location.href).href : null;
async function api(path, payload) {
  const r = await fetch(API + path, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "the server answered " + r.status);
  return j;
}
const chatSubs = new Set();
const chatApi = {
  listening: false,
  get: (thread) => api("chat?thread=" + encodeURIComponent(thread)),
  send: (thread, text) => api("chat", { thread, text }),
  cancel: (thread) => api("jobs/cancel", { thread }),
  // "Claude is working…" with how long, so a job that is stuck is plain to see
  working: (since) => { const m = since ? Math.floor((Date.now() - since) / 60000) : 0; return "Claude is working…" + (m >= 1 ? ` ${m} min` : ""); },
  subscribe(cb) { chatSubs.add(cb); return () => chatSubs.delete(cb); },
};
function fire(ev) { for (const cb of [...chatSubs]) { try { cb(ev); } catch (e) { chatSubs.delete(cb); } } }   // a player that was reloaded is gone: drop it
if (API) api("health").then((h) => {
  if (!h || !h.ok) return;
  chatApi.listening = !!h.listening; simxp.chat = chatApi;
  LCHAT = buildIndexChat(); renderRepos();
  const es = new EventSource(API + "events");
  es.addEventListener("worker", (e) => { chatApi.listening = JSON.parse(e.data).listening; fire({ type: "worker" }); });
  es.addEventListener("chat", (e) => fire({ type: "chat", ...JSON.parse(e.data) }));
  es.addEventListener("playbooks", (e) => onPlaybooksChanged(JSON.parse(e.data).ids || []));
  es.addEventListener("audio", (e) => { const ids = JSON.parse(e.data).ids || []; if (simxp.src === LOCAL_SRC && simxp.current && ids.includes(simxp.current.meta.id)) try { stage.contentWindow.player.refreshAudio(); } catch (err) { /* no player */ } });
}).catch(() => { /* not sim-xp's server: no chat */ });
async function onPlaybooksChanged(ids) {
  const src = sources.get(LOCAL_SRC); if (!src) return;
  await loadIndex(src, true);
  if (simxp.src !== LOCAL_SRC || !simxp.current || !ids.includes(simxp.current.meta.id)) return;
  // the open playbook changed on disk: reload it in the player at the same place (a file that does not validate is left alone)
  const id = simxp.current.meta.id, item = src.items.find((x) => x.id === id) || { id, file: id + ".json", title: id };
  let pb; try { pb = await fetchPlaybook(src, item); } catch (e) { return; }
  try { simxp.restore = stage.contentWindow.player.state(); } catch (e) { simxp.restore = null; }
  setBox(JSON.stringify(pb, null, 2)); repoLoaded = { text: pbBox.value, src: LOCAL_SRC, id };
  simxp.current = pb; stage.srcdoc = PLAYER_HTML + "<!-- " + Date.now() + " -->";
}
// a chat log: the person's messages, Claude's replies, and status lines from the worker
function renderChat(ol, messages) {
  ol.replaceChildren();
  for (const m of messages) {
    const li = document.createElement("li"); li.className = "cm " + (m.author === "user" ? "me" : m.author === "status" ? "st" : "ai") + (m.queued ? " queued" : "");
    li.textContent = m.text; ol.append(li);
  }
  ol.scrollTop = ol.scrollHeight;
}
function buildIndexChat() {
  const el = document.createElement("section"); el.className = "lchat"; el.setAttribute("aria-label", "Simulate a story with Claude");
  el.innerHTML = `<div class="chead"><b>Simulate a story</b><span class="pres" role="status"><i></i><span>…</span></span></div><ol class="clog" aria-live="polite"></ol><div class="cbar"><textarea rows="2" placeholder="Describe a story to simulate: a blog post URL, an incident, or a concept and what goes wrong" aria-label="Story to simulate"></textarea><button type="button" class="primary">Simulate</button></div><p class="cstat"></p>`;
  const ol = el.querySelector("ol"), ta = el.querySelector("textarea"), btn = el.querySelector(".cbar button"), st = el.querySelector(".cstat");
  const stop = document.createElement("button"); stop.type = "button"; stop.className = "tlink cstop"; stop.textContent = "Stop"; stop.hidden = true;
  stop.title = "Stop waiting for Claude: drops this request (and any queued after it)";
  stop.onclick = async () => { stop.disabled = true; try { await chatApi.cancel("new"); } catch (e) { st.textContent = e.message; st.hidden = false; } stop.disabled = false; };
  el.querySelector(".chead").append(stop);
  setInterval(() => { if (busy) refresh(); }, 30000);
  let busy = false, since = null, made = [];   // made: playbooks this chat created during this visit, with a Play link each
  async function refresh() {
    let r; try { r = await chatApi.get("new"); } catch (e) { st.textContent = "The local server is not answering."; return; }
    busy = r.busy; since = r.since; renderChat(ol, r.messages);
    for (const m of made) {
      const li = document.createElement("li"), b = document.createElement("button");
      li.className = "cm made"; li.append(`✓ ${m.reply} `); b.type = "button"; b.className = "tlink"; b.textContent = "Play ▶";
      b.onclick = () => { try { history.pushState(null, "", "#" + LOCAL_SRC + ":" + encodeURIComponent(m.id)); } catch (e) { /* not allowed */ } openHash(); };
      li.append(b); ol.append(li);
    }
    ol.hidden = !ol.children.length; ol.scrollTop = ol.scrollHeight;
    const pr = el.querySelector(".pres"), on = chatApi.listening;
    pr.className = "pres" + (on ? (busy ? " busy" : " on") : "");
    pr.lastChild.textContent = on ? (busy ? chatApi.working(since) : "Claude is listening") : "Claude is offline";
    st.textContent = on ? "" : "To start it: in Claude Code, in this repo, run /simxp."; st.hidden = on; st.classList.toggle("off", !on);
    stop.hidden = !busy;
  }
  async function send() {
    const text = ta.value.trim(); if (!text) return;
    btn.disabled = true;
    try { await chatApi.send("new", text); ta.value = ""; } catch (e) { st.textContent = e.message; } finally { btn.disabled = false; ta.focus(); }
  }
  btn.onclick = send;
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  chatApi.subscribe((ev) => {
    if (ev.type === "chat" && ev.created) made.push({ id: ev.created, reply: ev.reply });
    if (ev.type === "worker" || (ev.type === "chat" && ev.thread === "new")) refresh();
  });
  refresh();
  return { el };
}
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

// the sim-xp name in the header: back to the top of the index (a new tab with a modifier key, as a link)
$("brandHome").onclick = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); showIndex(); try { scrollTo({ top: 0 }); } catch (err) { /* old browser */ } };
