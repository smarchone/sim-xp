// sim-xp as an artifact: the player fills the page. A chat bar asks Claude (the viewer's own Claude, through the `sample`
// capability) to write a playbook into the playbook box; Run plays whatever is in the box.
// Globals the build adds above this file: PLAYER_HTML, SEEDS (the two bundled playbooks: the default and the format example; every other playbook is loaded from a GitHub repo on demand), EXAMPLE (the format reference Claude reads), DEFAULT (the playbook the box starts with),
// SPEC (the format and authoring rules), __playbook (the validator).
const { validate } = __playbook;
const $ = (id) => document.getElementById(id);
const stage = $("stage"), pbBox = $("pb"), logEl = $("log"), statusEl = $("status"), problemsEl = $("problems");
const askEl = $("ask"), sendBtn = $("send"), stopBtn = $("stop"), runBtn = $("runBtn"), saveBtn = $("saveBtn");

// ---------- player frame (the player reads simxp.current when it boots and reports back through onPlayerEvent) ----------
const simxp = (window.simxp = {
  current: null,
  source: null,
  showLibrary() { setOpen(true); pbBox.focus(); },
  onPlayerEvent(type) { if (type === "ready") stage.contentWindow.focus(); },
});
const LAST = "sim-xp.last";   // the playbook played last, reopened on the next visit
function play(pb, src = null) {   // src: the library source (key) the playbook came from, when it was loaded from a repo
  if (!src && SEEDS.some((x) => JSON.stringify(x) === JSON.stringify(pb))) src = DEFAULT_SRC;   // the two bundled playbooks are copies of the default repo's
  simxp.current = pb; simxp.source = "box"; simxp.src = src;
  try { localStorage.setItem(LAST, JSON.stringify(pb)); } catch (e) { /* storage blocked: it starts on the default next time */ }
  stage.srcdoc = PLAYER_HTML + "<!-- " + Date.now() + " -->";
  track(pb);
}
// Mark the run in the address (#<playbook id>) and send a Google Analytics event. Both are best effort: the artifact has no gtag and may not allow history changes.
function track(pb) {
  const id = String(pb.meta.id), src = simxp.src || "";   // #<owner/repo[@ref][/path]>:<id> for a repo playbook (the default repo too), plain #<id> for one in the Saved list
  try { history.replaceState(null, "", "#" + (src ? encodeURI(src) + ":" : "") + encodeURIComponent(id)); } catch (e) { /* not allowed here (artifact frame) */ }
  try { if (typeof window.gtag === "function") window.gtag("event", "playbook_run", { playbook_id: id, playbook_title: pb.meta.title }); } catch (e) { /* analytics blocked */ }
}

// ---------- the side panel: open while writing, a thin rail while watching ----------
const panelIn = $("panelIn"), rail = $("rail");
function setOpen(open) { panelIn.hidden = !open; rail.hidden = open; }
$("collapse").onclick = () => setOpen(false);
rail.onclick = () => { setOpen(true); askEl.focus(); };
// starts open; Collapse gives the player the room back
const panel = $("panel"), WIDTH = "sim-xp.panelWidth";
const setWidth = (w) => panel.style.setProperty("--pw", Math.max(300, Math.min(760, Math.round(w))) + "px");
try { const w = Number(localStorage.getItem(WIDTH)); if (w) setWidth(w); } catch (e) { /* storage blocked */ }
$("grip").addEventListener("pointerdown", (e) => {
  e.preventDefault(); document.body.classList.add("resizing"); $("grip").classList.add("drag");
  const move = (ev) => setWidth(innerWidth - ev.clientX);
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up);
    document.body.classList.remove("resizing"); $("grip").classList.remove("drag");
    try { localStorage.setItem(WIDTH, String(panelIn.offsetWidth)); } catch (e) { /* storage blocked */ }
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up);
});

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
  if (last.empty) statusEl.textContent = "empty";
  else if (last.errors.length) {
    statusEl.textContent = `${last.errors.length} problem${last.errors.length === 1 ? "" : "s"}`; statusEl.classList.add("bad");
    for (const e of last.errors) { const li = document.createElement("li"); li.textContent = e; problemsEl.append(li); }
  } else {
    statusEl.textContent = "valid" + (last.warnings.length ? ` · ${last.warnings.length} warning${last.warnings.length === 1 ? "" : "s"}` : "");
    statusEl.classList.add(last.warnings.length ? "warn" : "ok");
    statusEl.title = last.warnings.join("\n");
  }
  problemsEl.hidden = !problemsEl.children.length;
  const ok = !last.empty && !last.errors.length;
  runBtn.disabled = !ok; if (saveBtn.dataset.can) saveBtn.hidden = !ok;
}
let t = 0;
pbBox.addEventListener("input", () => { clearTimeout(t); t = setTimeout(refresh, 300); });
function setBox(text) { pbBox.value = text; refresh(); }

function run() {
  refresh();
  if (last.empty || last.errors.length) return;
  const fromRepo = repoLoaded && repoLoaded.text === pbBox.value;   // a repo playbook stays in its repo; only what the person wrote or edited is saved
  if (!fromRepo && repoLoaded && last.pb.meta.id === repoLoaded.id) {   // an edited copy never takes the repo playbook's id: its link and Saved entry stay its own
    let id = repoLoaded.id + "-copy", n = 2;
    while (library.has(docId({ meta: { id } }))) id = `${repoLoaded.id}-copy-${n++}`;
    last.pb.meta.id = id; setBox(JSON.stringify(last.pb, null, 2));
  }
  play(last.pb, fromRepo ? repoLoaded.src : null); setOpen(false);
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
  catch (e) { say("note", "This browser would not keep that. Export the playbook with the arrow button instead."); return false; }
}
const docId = (pb) => "pb_" + String(pb.meta.id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
const entryOf = (pb, updated) => ({ title: pb.meta.title, story: pb.meta.story, duration_s: pb.meta.duration_s, beats: (pb.timeline || []).filter((e) => e.beat).length, updated, json: JSON.stringify(pb) });
function saveToLibrary(pb) {
  if (!storageOk) return false;
  const json = JSON.stringify(pb), id = docId(pb), old = library.get(id);
  if (old && old.json === json) return true;
  if (!old && library.size >= MAX_SAVED) { say("note", `Your list holds ${MAX_SAVED} playbooks. Delete one to save this one, or export it with Save .json.`); return false; }
  const entry = entryOf(pb, Date.now());
  const before = new Map(library);
  library.delete(id);
  const next = new Map([[id, entry], ...library]);   // newest first
  library.clear(); for (const [k, v] of next) library.set(k, v);
  if (!persist()) { library.clear(); for (const [k, v] of before) library.set(k, v); return false; }
  renderLibrary();
  return true;
}
function renderLibrary() {
  savedList.replaceChildren();
  $("savedCount").textContent = library.size ? `(${library.size} of ${MAX_SAVED})` : "";
  if (!library.size) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "Playbooks Claude writes, and files you run, are kept here, in this browser only."; savedList.append(li); return; }
  for (const [id, x] of library) {
    const li = document.createElement("li"), open = document.createElement("button"), play_ = document.createElement("button"), del = document.createElement("button");
    open.className = "pick"; open.title = x.story || "";
    const b = document.createElement("b"), s = document.createElement("span");
    b.textContent = x.title || id; s.textContent = `${Math.round((x.duration_s || 0) / 60)} min · ${x.beats || 0} key moments · ${new Date(x.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    open.append(b, s);
    const load = () => { try { setBox(JSON.stringify(JSON.parse(x.json), null, 2)); return true; } catch (e) { say("note", "That saved playbook could not be read."); return false; } };
    open.onclick = load;
    play_.textContent = "▶"; play_.title = "Load and run"; play_.setAttribute("aria-label", "Load and run " + (x.title || id));
    play_.onclick = () => { if (load()) run(); };
    li.append(open, play_);
    if (downloads) {
      const ex = document.createElement("button");
      ex.textContent = "⤓"; ex.title = "Export as a .json file"; ex.setAttribute("aria-label", "Export " + (x.title || id));
      ex.onclick = async () => { try { await downloads.save({ filename: id.replace(/^pb_/, "") + ".json", data: JSON.stringify(JSON.parse(x.json), null, 2) }); } catch (e) { say("note", "The file was not saved."); } };
      li.append(ex);
    }
    del.textContent = "✕"; del.title = "Delete from this browser"; del.setAttribute("aria-label", "Delete " + (x.title || id));
    del.onclick = () => {
      if (del.dataset.sure) { library.delete(id); persist(); renderLibrary(); return; }
      del.dataset.sure = "1"; del.textContent = "Delete?"; setTimeout(() => { del.dataset.sure = ""; del.textContent = "✕"; }, 3000);
    };
    li.append(del); savedList.append(li);
  }
}
if (storageOk) { savedEl.hidden = false; renderLibrary(); }

// ---------- library: playbooks loaded from GitHub repos, on demand ----------
// A source is a folder of playbook .json files plus an index.json listing them (format in v2/README.md). The panel fetches the index when
// the Library is opened and a playbook only when it is clicked; nothing from a repo is copied into storage. Only the list of added repos is kept.
const DEFAULT_SRC = "smarchone/simxp-playbooks", SRCS = "sim-xp.repos", CACHE = "sim-xp.cache", TTL = 7 * 24 * 3600 * 1000, CACHE_MAX = 20;
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
  return { key: `${owner}/${repo}` + (m[3] ? "@" + ref : "") + (dir ? "/" + dir : ""), base: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}` + (dir ? "/" + dir : "") };
}
const sources = new Map();   // key -> { key, base, items, state: "idle" | "loading" | "ok" | "err", error, promise }
function addSource(text) {
  const p = parseSrc(text);
  if (!p) return null;
  if (!sources.has(p.key)) sources.set(p.key, { ...p, items: [], state: "idle", error: "" });
  return sources.get(p.key);
}
const userSources = () => [...sources.keys()].filter((k) => k !== DEFAULT_SRC);
function saveSources() { try { localStorage.setItem(SRCS, JSON.stringify(userSources())); } catch (e) { /* storage blocked: added repos last this visit only */ } }
addSource(DEFAULT_SRC);
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
  const pb = await getJson(src.base + "/" + item.file, true).catch((e) => { throw new Error(`${item.file}: ${e.message}`); }), r = validate(pb);
  if (r.errors.length) throw new Error(`${item.file} is not a valid playbook (${r.errors[0]})`);
  return pb;
}
let repoLoaded = null;   // { text, src, id }: what the box holds when it came from a repo unchanged
async function openFromRepo(src, item, andRun) {
  try {
    const pb = await fetchPlaybook(src, item);
    setBox(JSON.stringify(pb, null, 2)); repoLoaded = { text: pbBox.value, src: src.key, id: pb.meta.id };
    if (andRun) run();
  } catch (e) { say("note", "Could not load that playbook: " + (e.message || "network error")); setOpen(true); }
}
const repoEl = $("repo"), repoList = $("repoList"), repoIn = $("repoIn");
let openSrc = DEFAULT_SRC;   // the one import that is expanded
const label = (src) => src.key === DEFAULT_SRC ? "sim-xp playbooks" : src.key;
function expand(src) {
  openSrc = openSrc === src.key ? null : src.key;
  if (openSrc && (src.state === "idle" || (src.state === "err" && !src.promise))) loadIndex(src); else renderRepos();
}
function renderRepos() {
  repoList.replaceChildren();
  for (const src of sources.values()) {
    const open = openSrc === src.key, head = document.createElement("li"), toggle = document.createElement("button"), name = document.createElement("b"), st = document.createElement("span");
    head.className = "src"; toggle.className = "srctoggle"; toggle.setAttribute("aria-expanded", String(open)); toggle.title = src.key;
    name.textContent = (open ? "▾ " : "▸ ") + label(src);
    st.textContent = src.state === "loading" ? "loading…" : src.state === "err" ? src.error : src.state === "ok" ? `${src.items.length}` : "";
    if (src.state === "err") st.className = "bad";
    toggle.append(name, st); toggle.onclick = () => expand(src);
    head.append(toggle);
    const refresh_ = document.createElement("button");
    refresh_.textContent = "↻"; refresh_.title = "Fetch the list again"; refresh_.setAttribute("aria-label", "Refresh " + label(src)); refresh_.onclick = () => { openSrc = src.key; loadIndex(src, true); };
    head.append(refresh_);
    if (src.key !== DEFAULT_SRC) {
      const del = document.createElement("button");
      del.textContent = "✕"; del.title = "Remove this repo from the list"; del.setAttribute("aria-label", "Remove " + src.key);
      del.onclick = () => { sources.delete(src.key); if (openSrc === src.key) openSrc = DEFAULT_SRC; saveSources(); renderRepos(); };
      head.append(del);
    }
    repoList.append(head);
    if (!open) continue;
    for (const item of src.items) {
      const li = document.createElement("li"), pick = document.createElement("button"), go = document.createElement("button");
      pick.className = "pick"; pick.title = item.story || "";
      const b = document.createElement("b"), s = document.createElement("span");
      b.textContent = item.title; s.textContent = Array.isArray(item.tags) ? item.tags.slice(0, 3).join(" · ") : "";
      pick.append(b); if (s.textContent) pick.append(s); pick.onclick = () => openFromRepo(src, item, false);
      go.textContent = "▶"; go.title = "Load and run"; go.setAttribute("aria-label", "Load and run " + item.title); go.onclick = () => openFromRepo(src, item, true);
      li.append(pick, go); repoList.append(li);
    }
  }
}
renderRepos();
repoEl.addEventListener("toggle", () => { const src = sources.get(openSrc); if (repoEl.open && src && src.state === "idle") loadIndex(src); });
function addRepoFromInput() {
  const src = addSource(repoIn.value);
  if (!src) { say("note", "That is not a repo. Write it as owner/repo, owner/repo@branch/folder, or paste its github.com link."); setOpen(true); return; }
  repoIn.value = ""; saveSources(); openSrc = src.key; loadIndex(src, true);
}
$("repoAdd").onclick = addRepoFromInput;
repoIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addRepoFromInput(); } });

// ---------- files in and out ----------
async function openText(text, name) {
  setBox(text);
  say("note", `Loaded ${name} into the box. ${last.errors.length ? "It has problems, see the box." : "Press Run to play it."}`);
  setOpen(true);
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
  renderLibrary();
  saveBtn.dataset.can = "1"; saveBtn.hidden = runBtn.disabled;
  saveBtn.onclick = async () => {
    if (last.empty || last.errors.length) return;
    try { await downloads.save({ filename: (last.pb.meta.id || "playbook") + ".json", data: pbBox.value }); } catch (e) { say("note", "The file was not saved."); }
  };
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
HELLO.innerHTML = "<b>Ask for a playbook.</b> Give me a story, a postmortem, a concept, or just a system and what goes wrong. I write it into the box, and you press Run. You can also ask me to change what is in the box. It starts with an example you can run.";

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
  not_granted: "Claude is not allowed for this page. Allow it when asked, or paste a playbook into the box.",
  rate_limited: "Too many requests, or your Claude usage limit is reached. Try again later.",
  session_expired: "Your session expired. Sign in to Claude again, then retry.",
  refused: "Claude declined that request. Try asking for something different.",
  empty_completion: "Claude sent nothing back. Try again with a bit more detail.",
  prompt_too_large: "The playbook in the box is too large to send along. Clear the box and ask again.",
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
  setBusy(true); setOpen(true); askEl.value = "";
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
    setBusy(false); setBox(out);
    if (res.truncated) say("err", "Claude hit its length limit and the playbook is cut off. Ask for a shorter one, for example fewer feed lines and charts.");
    else if (last.errors.length) {
      const m = say("err", `The playbook has ${last.errors.length} problem${last.errors.length === 1 ? "" : "s"} (listed in the box).`);
      const b = document.createElement("button"); b.textContent = "Ask Claude to fix them"; b.onclick = () => { b.remove(); send("Fix the validator problems and return the whole playbook."); }; m.append(b);
    } else {
      const kept = await saveToLibrary(last.pb);
      say("note", `${last.pb.meta.title} is in the box${kept ? " and saved" : ""}. Press Run to play it.`);
      runBtn.focus();
    }
  } catch (e) {
    if (wrote) { pbBox.value = prev; }
    setBusy(false); refresh();
    if (e && e.code === "cancelled") bubble.textContent = "Stopped. The box is as it was.";
    else { bubble.remove(); say("err", COPY[e && e.code] || "Something went wrong talking to Claude. The box is as it was; try again."); }
  } finally { ctl = null; }
}
// a <form> would be blocked by the artifact sandbox, so Send and Enter are plain handlers
sendBtn.onclick = () => send(askEl.value);
askEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(askEl.value); } });
stopBtn.onclick = () => ctl && ctl.abort();

// ---------- start: put the default playbook in the box and play it ----------
// The box starts with the playbook named by the address (#<id>: the saved copy, else a bundled one, else the one with that id in a repo; #<repo>:<id> for a repo that is not the default). With no usable id it is the last playbook played here (the saved copy, else the bundled one, else what was stored), or the default on a first visit.
function hashTarget() {
  let h = ""; try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { return null; }
  if (!h) return null;
  const i = h.indexOf(":");
  return i > 0 ? { src: h.slice(0, i), id: h.slice(i + 1) } : { src: null, id: h };
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
  if (!t || (simxp.current && simxp.current.meta.id === t.id && (t.src || null) === (simxp.src || null))) return;
  const pb = playbookFromHash();
  if (pb) { setBox(JSON.stringify(pb, null, 2)); repoLoaded = null; play(last.pb); } else playFromRepoHash(t);
}
window.addEventListener("hashchange", openHash);   // the person edited the address or used Back
function startingPlaybook() {
  const fromHash = playbookFromHash(); if (fromHash) return fromHash;
  try {
    const x = JSON.parse(localStorage.getItem(LAST) || "null");
    if (x && x.meta && x.meta.id) {
      const saved = library.get(docId(x)); let pb = null;
      try { pb = saved ? JSON.parse(saved.json) : null; } catch (e) { /* unreadable saved copy */ }
      pb = pb || SEEDS.find((s) => s.meta.id === x.meta.id) || x;
      if (!validate(pb).errors.length) return pb;
    }
  } catch (e) { /* nothing stored */ }
  return DEFAULT;
}
const startTarget = hashTarget() && !playbookFromHash() ? hashTarget() : null;   // an id in the address that is not saved or bundled; read before the first play rewrites the address
setBox(JSON.stringify(startingPlaybook(), null, 2));
if (!last.errors.length) play(last.pb);
if (startTarget) playFromRepoHash(startTarget);   // named in the address but not here: fetch it from a repo
(async () => {
  try { sample = await window.claude?.use?.("sample"); } catch (e) { sample = null; }
  if (!sample) { askEl.disabled = true; sendBtn.disabled = true; askEl.placeholder = "Chat needs Claude. Paste or open a playbook instead."; say("note", "Chat with Claude only works in the sim-xp Claude artifact. Here you can paste or open a playbook, run it, and keep up to 20 in the Saved list."); }
  else askEl.disabled = busy;
})();
