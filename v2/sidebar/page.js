// sim-xp as an artifact: the player fills the page. A chat bar asks Claude (the viewer's own Claude, through the `sample`
// capability) to write a playbook into the playbook box; Run plays whatever is in the box.
// Globals the build adds above this file: PLAYER_HTML, SEEDS (the bundled playbooks), EXAMPLE (the format reference Claude reads), DEFAULT (the playbook the box starts with),
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
function play(pb) {
  simxp.current = pb; simxp.source = "box";
  try { localStorage.setItem(LAST, JSON.stringify(pb)); } catch (e) { /* storage blocked: it starts on the default next time */ }
  stage.srcdoc = PLAYER_HTML + "<!-- " + Date.now() + " -->";
  track(pb);
}
// Mark the run in the address (#<playbook id>) and send a Google Analytics event. Both are best effort: the artifact has no gtag and may not allow history changes.
function track(pb) {
  const id = String(pb.meta.id);
  try { history.replaceState(null, "", "#" + encodeURIComponent(id)); } catch (e) { /* not allowed here (artifact frame) */ }
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
    const m = last.pb.meta, beats = (last.pb.timeline || []).filter((e) => e.beat).length;
    statusEl.textContent = `valid · ${Math.round(m.duration_s / 60)} min · ${beats} key moments` + (last.warnings.length ? ` · ${last.warnings.length} warning${last.warnings.length === 1 ? "" : "s"}` : "");
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
  play(last.pb); setOpen(false);
  if (last.pb.meta.id !== DEFAULT.meta.id) saveToLibrary(last.pb);
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
// The bundled playbooks are put into the list on a first visit, and again on "Restore examples". They fill free slots only, after the person's own.
function addSeeds() {
  let added = 0, full = false;
  for (const [i, pb] of SEEDS.entries()) {
    const id = docId(pb);
    if (library.has(id)) continue;
    if (library.size >= MAX_SAVED) { full = true; break; }
    library.set(id, entryOf(pb, Date.now() - i * 1000)); added++;
  }
  return { added, full };
}
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
  const foot = document.createElement("li"), restore = document.createElement("button");
  foot.className = "foot"; restore.textContent = "Restore examples"; restore.title = "Put the bundled examples back into the list";
  restore.onclick = () => {
    const r = addSeeds();
    if (r.added) { persist(); renderLibrary(); }
    else say("note", r.full ? `Your list holds ${MAX_SAVED} playbooks. Delete one to restore the examples.` : "All the examples are already in your list.");
  };
  foot.append(restore);
  if (!library.size) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "Playbooks Claude writes, and files you run, are kept here, in this browser only."; savedList.append(li); savedList.append(foot); return; }
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
  savedList.append(foot);
}
if (storageOk) {
  let seeded = false;
  try { seeded = localStorage.getItem("sim-xp.seeded") === "1"; } catch (e) { /* storage blocked */ }
  if (!seeded) { addSeeds(); persist(); try { localStorage.setItem("sim-xp.seeded", "1"); } catch (e) { /* storage blocked */ } }
  savedEl.hidden = false; renderLibrary();
}

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
// The box starts with the playbook named by the address (#<id>: the saved copy, else the bundled one). With no usable id it is the last playbook played here (the saved copy, else the bundled one, else what was stored), or the default on a first visit.
function playbookFromHash() {
  let id = ""; try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return null; }
  if (!id) return null;
  let pb = null;
  const saved = library.get(docId({ meta: { id } }));
  try { pb = saved ? JSON.parse(saved.json) : null; } catch (e) { /* unreadable saved copy */ }
  pb = pb || SEEDS.find((s) => s.meta.id === id) || null;
  return pb && !validate(pb).errors.length ? pb : null;
}
window.addEventListener("hashchange", () => {   // the person edited the address or used Back
  const pb = playbookFromHash();
  if (pb && (!simxp.current || simxp.current.meta.id !== pb.meta.id)) { setBox(JSON.stringify(pb, null, 2)); play(last.pb); }
});
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
setBox(JSON.stringify(startingPlaybook(), null, 2));
if (!last.errors.length) play(last.pb);
(async () => {
  try { sample = await window.claude?.use?.("sample"); } catch (e) { sample = null; }
  if (!sample) { askEl.disabled = true; sendBtn.disabled = true; askEl.placeholder = "Chat needs Claude. Paste or open a playbook instead."; say("note", "Chat with Claude only works in the sim-xp Claude artifact. Here you can paste or open a playbook, run it, and keep up to 20 in the Saved list."); }
  else askEl.disabled = busy;
})();
