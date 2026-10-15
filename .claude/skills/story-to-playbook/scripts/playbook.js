// sim-xp playbook@2: validation and a noise-free simulation, shared by the page (WebMCP tools) and the CLI.
// validate(pb) never throws: it returns { ok, errors, warnings, world }. world is null when there are errors.

export const SCHEMA = "sim-xp/playbook@2";

// Noise-free series per metric, one value per second (the player draws the same curves, plus jitter).
export function simulate(PB) {
  const D = PB.meta.duration_s, series = {};
  for (const x of PB.metrics) {
    const kfs = {}; PB.timeline.forEach(e => (e.metrics || []).filter(k => k.id === x.id).forEach(k => (kfs[e.t] = k)));
    let v = x.start, seg = null; const out = [];
    for (let s = 0; s <= D; s++) {
      if (kfs[s]) { const k = kfs[s]; seg = { from: v, to: k.to, t0: s, dur: k.over_s || 0, shape: k.shape || "ease" }; }
      if (seg) { let p = seg.dur ? Math.min(1, (s - seg.t0) / seg.dur) : 1; if (seg.shape === "step") p = 1; const q = seg.shape === "linear" ? p : p * p * (3 - 2 * p); v = seg.from + (seg.to - seg.from) * q; }
      out[s] = v;
    }
    series[x.id] = out;
  }
  return series;
}

// When each alert fires and resolves, from the curves.
export function alertEvents(PB, series) {
  const D = PB.meta.duration_s, out = [];
  for (const a of PB.alerts || []) {
    let since = null, firing = false;
    for (let s = 0; s <= D; s++) {
      const c = a.op === ">" ? series[a.metric][s] > a.value : series[a.metric][s] < a.value;
      if (c) { if (since == null) since = s; } else since = null;
      const f = c && s - since >= a.for_s;
      if (f && !firing) out.push({ t: s, alert: a.id, event: "fires" });
      if (!f && firing) out.push({ t: s, alert: a.id, event: "resolves" });
      firing = f;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const round = v => Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
export const valuesAt = (PB, series, t) => Object.fromEntries(PB.metrics.map(x => [x.id, round(series[x.id][Math.max(0, Math.min(PB.meta.duration_s, Math.round(t)))])]));

export function validate(PB) {
  if (!PB || typeof PB !== "object" || Array.isArray(PB)) return { ok: false, errors: ["the playbook must be a JSON object"], warnings: [], world: null };
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  const COLORS = ["red", "amber", "green", "blue", "teal", "violet", "pink", "grey"];
  const NODE_KNOBS = ["color", "intensity", "pulse", "label", "badge", "down"];
  const EDGE_KNOBS = ["color", "flow", "reverse", "width"];
  const SHAPES = ["ease", "linear", "step"];
  const FEED_KINDS = ["chat", "log", "deploy", "alert", "resolved"];
  const isNum = v => typeof v === "number" && Number.isFinite(v);

  if (PB.schema !== "sim-xp/playbook@2") err(`schema must be "sim-xp/playbook@2"`);
  const m = PB.meta || {};
  for (const k of ["id", "title", "story", "duration_s"]) if (m[k] == null) err(`meta.${k} is required`);
  const D = m.duration_s;
  if (!isNum(D) || D < 60 || D > 1800) err("meta.duration_s must be a number between 60 and 1800");
  // intro context (all optional, but a good playbook has them: the intro is where the viewer learns what they are looking at)
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  if (m.background != null) {
    if (!Array.isArray(m.background) || !m.background.length) err("meta.background must be a list of { title, body } (2–4 short paragraphs)");
    else {
      if (m.background.length > 5) warn("meta.background has more than 5 paragraphs; the intro should be quick to read");
      m.background.forEach((b, i) => { const body = typeof b === "string" ? b : b && b.body; if (!str(body)) err(`meta.background[${i}] needs a body`); else if (body.length > 420) warn(`meta.background[${i}] is ${body.length} chars; keep under ~400`); });
    }
  } else warn("meta.background is missing: the intro will only show the story line");
  if (m.cast != null) { if (!Array.isArray(m.cast)) err("meta.cast must be a list of { name, role }"); else m.cast.forEach((c, i) => { if (!c || !str(c.name) || !str(c.role)) err(`meta.cast[${i}] needs name and role`); }); }
  if (m.watch != null) { if (!Array.isArray(m.watch)) err("meta.watch must be a list of { label, normal }"); else m.watch.forEach((w, i) => { if (!w || !str(w.label) || !str(w.normal)) err(`meta.watch[${i}] needs label and normal (e.g. "normal < 1 s")`); }); }
  if (m.learn != null) { if (!Array.isArray(m.learn) || m.learn.some((x) => !str(x))) err("meta.learn must be a list of short strings"); else if (m.learn.length > 4) warn("meta.learn has more than 4 items"); }

  // components
  const nodes = PB.components?.nodes || [], edges = PB.components?.edges || [];
  if (!nodes.length) err("components.nodes is empty");
  if (nodes.length > 14) warn(`${nodes.length} nodes: more than ~12 gets hard to read`);
  const nodeIds = new Set(), partIds = new Set(), edgeIds = new Set();
  for (const n of nodes) {
    if (!n.id || !n.label) err(`node needs id and label: ${JSON.stringify(n)}`);
    if (nodeIds.has(n.id)) err(`duplicate node id ${n.id}`); nodeIds.add(n.id);
    if (n.label && n.label.length > 22) warn(`node ${n.id} label "${n.label}" is long (>22 chars)`);
    for (const p of n.parts || []) { if (!p.id) err(`part without id in ${n.id}`); partIds.add(n.id + "/" + p.id); }
    if ((n.parts || []).length > 12) warn(`node ${n.id} has ${(n.parts || []).length} parts: more than ~8 gets cramped`);
  }
  for (const e of edges) {
    if (!e.id) err(`edge without id: ${JSON.stringify(e)}`);
    if (edgeIds.has(e.id) || nodeIds.has(e.id)) err(`duplicate id ${e.id}`); edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) err(`edge ${e.id}: unknown from "${e.from}"`);
    if (!nodeIds.has(e.to)) err(`edge ${e.id}: unknown to "${e.to}"`);
  }

  // metrics, dashboard, alerts
  const metrics = PB.metrics || [], metricIds = new Set();
  for (const x of metrics) {
    if (!x.id || !x.label || x.unit == null || !isNum(x.start)) err(`metric needs id, label, unit, start: ${JSON.stringify(x)}`);
    if (metricIds.has(x.id)) err(`duplicate metric ${x.id}`); metricIds.add(x.id);
    if (x.noise != null && (x.noise < 0 || x.noise > 0.3)) warn(`metric ${x.id} noise ${x.noise}: keep between 0 and 0.3`);
  }
  const panels = PB.dashboard || [], panelIds = new Set();
  if (!panels.length) err("dashboard is empty");
  if (panels.length > 8) warn(`${panels.length} panels: 4–6 is the sweet spot`);
  for (const p of panels) {
    if (panelIds.has(p.id)) err(`duplicate panel ${p.id}`); panelIds.add(p.id);
    if (!p.metrics?.length) err(`panel ${p.id} has no metrics`);
    if (p.max != null && !isNum(p.max)) err(`panel ${p.id}: max must be a number`);
    for (const id of p.metrics || []) if (!metricIds.has(id)) err(`panel ${p.id}: unknown metric ${id}`);
    if ((p.metrics || []).length > 2) warn(`panel ${p.id} plots ${p.metrics.length} metrics: max 2 reads well`);
  }
  for (const a of PB.alerts || []) {
    if (!metricIds.has(a.metric)) err(`alert ${a.id}: unknown metric ${a.metric}`);
    if (a.component && !nodeIds.has(a.component)) err(`alert ${a.id}: unknown component ${a.component}`);
    if (![">", "<"].includes(a.op)) err(`alert ${a.id}: op must be ">" or "<"`);
    if (!["critical", "warning"].includes(a.severity)) err(`alert ${a.id}: severity must be critical or warning`);
  }

  // effects
  const checkEffect = (eff, where) => {
    const t = eff.target;
    const isNode = nodeIds.has(t) || partIds.has(t), isEdge = edgeIds.has(t);
    if (!isNode && !isEdge) { err(`${where}: unknown effect target "${t}"`); return; }
    const allowed = isEdge ? EDGE_KNOBS : NODE_KNOBS;
    for (const k of Object.keys(eff)) {
      if (k === "target") continue;
      if (!allowed.includes(k)) err(`${where}: knob "${k}" not allowed on ${isEdge ? "edge" : "node/part"} ${t} (allowed: ${allowed.join(", ")})`);
    }
    if (eff.color != null && !COLORS.includes(eff.color) && !/^#[0-9a-f]{6}$/i.test(eff.color)) err(`${where}: color "${eff.color}" (use ${COLORS.join(", ")})`);
    if (typeof eff.label === "string") { const lim = partIds.has(t) ? 10 : 30; if (eff.label.length > lim) warn(`${where}: label "${eff.label}" over ${lim} chars on ${t}; it will be cut`); }
    if (typeof eff.badge === "string" && eff.badge.length > 12) warn(`${where}: badge "${eff.badge}" over 12 chars`);
    for (const k of ["intensity", "flow", "reverse", "width"]) if (eff[k] != null && (!isNum(eff[k]) || eff[k] < 0 || eff[k] > 1.2)) err(`${where}: ${k} must be 0..1`);
  };
  (PB.initial?.effects || []).forEach((e, i) => checkEffect(e, `initial.effects[${i}]`));

  // timeline
  const tl = PB.timeline || [];
  if (!tl.length) err("timeline is empty");
  let prev = -1; const beats = [];
  tl.forEach((e, i) => {
    const w = `timeline[${i}] t=${e.t}`;
    if (!Number.isInteger(e.t) || e.t < 0 || e.t > D) err(`${w}: t must be an integer second in 0..duration`);
    if (e.t < prev) err(`${w}: timeline must be sorted by t`); prev = e.t;
    (e.effects || []).forEach((f, j) => checkEffect(f, `${w} effects[${j}]`));
    for (const k of e.metrics || []) {
      if (!metricIds.has(k.id)) err(`${w}: unknown metric ${k.id}`);
      if (!isNum(k.to)) err(`${w}: metric ${k.id} needs numeric "to"`);
      if (k.shape && !SHAPES.includes(k.shape)) err(`${w}: shape must be ${SHAPES.join("/")}`);
      if (k.over_s != null && (!isNum(k.over_s) || k.over_s < 0)) err(`${w}: over_s must be >= 0`);
    }
    if (e.feed) {
      if (!e.feed.from || !e.feed.text) err(`${w}: feed needs from and text`);
      if (e.feed.kind && !FEED_KINDS.includes(e.feed.kind)) err(`${w}: feed.kind must be ${FEED_KINDS.join("/")}`);
      if (e.feed.text && e.feed.text.length > 200) warn(`${w}: feed text over 200 chars`);
    }
    if (e.beat) {
      beats.push(e);
      if (!e.title) err(`${w}: a key moment (beat) needs a title`);
      if (!e.beat.hint) err(`${w}: beat needs a hint`);
      if (e.beat.hint && e.beat.hint.length > 340) warn(`${w}: hint is ${e.beat.hint.length} chars; keep under 340 so it fits`);
      for (const f of e.beat.focus || []) {
        const ok = nodeIds.has(f) || edgeIds.has(f) || partIds.has(f) || f === "feed" || (f.startsWith("panel:") && panelIds.has(f.slice(6)));
        if (!ok) err(`${w}: unknown focus "${f}" (node id, edge id, "panel:<id>" or "feed")`);
      }
      for (const n of e.beat.notes || []) {
        if (!panelIds.has(n.panel)) err(`${w}: note on unknown panel ${n.panel}`);
        const p = panels.find(p => p.id === n.panel);
        if (n.metric && p && !p.metrics.includes(n.metric)) err(`${w}: note metric ${n.metric} not on panel ${n.panel}`);
        if (!n.text) err(`${w}: note needs text`);
        else if (n.text.length > 80) warn(`${w}: note on ${n.panel} is ${n.text.length} chars; keep under ~70`);
      }
      if (!(e.beat.notes || []).length && beats.length > 1) warn(`${w}: key moment has no per-chart notes`);
    }
    if (e.title && e.title.length > 40) warn(`${w}: title over 40 chars`);
  });
  if (beats.length < 3) warn(`only ${beats.length} key moments; 4–7 tells a story`);
  if (beats.length > 8) warn(`${beats.length} key moments; more than 8 feels like a lecture`);
  if (beats.length && beats[0].t > 10) warn("first key moment should be near t=0 to introduce the system");
  if (!tl.some(e => e.feed)) warn("no feed messages: the feed will be empty");

  // report
  const r = PB.report || {};
  if (!r.tldr) err("report.tldr is required");
  const chainIds = new Set((r.chain || []).map(c => c.id));
  if (!(r.chain || []).length) err("report.chain is required (cause → effect → fix boxes)");
  if ((r.chain || []).length > 7) warn("report.chain over 7 boxes gets cramped");
  for (const c of r.chain || []) { if (!["cause", "effect", "amp", "fix"].includes(c.kind)) err(`report.chain ${c.id}: kind must be cause/effect/amp/fix`); if (c.text && c.text.length > 110) warn(`report.chain ${c.id}: text over 110 chars`); }
  if (r.loop && (!chainIds.has(r.loop.from) || !chainIds.has(r.loop.to))) err("report.loop from/to must be chain ids");
  for (const s of r.stats || []) { if (!metricIds.has(s.metric)) err(`report.stats: unknown metric ${s.metric}`); if (!["max", "min", "delta"].includes(s.agg)) err(`report.stats ${s.metric}: agg must be max/min/delta`); }
  // report.sparkline is no longer drawn; an old playbook that still has it stays valid
  if (r.math != null && (!r.math || !Array.isArray(r.math.lines) || !r.math.lines.length || r.math.lines.some((x) => typeof x !== "string"))) err("report.math must be { title?, lines: [string] }");
  if (r.myths != null) { if (!Array.isArray(r.myths)) err("report.myths must be a list of { myth, truth }"); else r.myths.forEach((x, i) => { if (!x || !str(x.myth) || !str(x.truth)) err(`report.myths[${i}] needs myth and truth`); }); }
  if (r.links != null) { if (!Array.isArray(r.links)) err("report.links must be a list of { label, url }"); else r.links.forEach((x, i) => { if (!x || !str(x.label) || !/^https:\/\//.test(x.url || "")) err(`report.links[${i}] needs a label and an https url`); }); }
  if (r.fix_t != null && (!Number.isInteger(r.fix_t) || r.fix_t > D)) err("report.fix_t must be an integer second within duration");
  const ln = r.learnings || [];
  if (ln.length < 2 || ln.length > 5) warn(`report.learnings has ${ln.length}; 3–4 is ideal`);
  for (const l of ln) { if (!l.title || !l.body) err("each learning needs title and body"); else if (l.title.length > 40) warn(`learning "${l.title}" title over 40 chars`); }

  let world = null;
  if (!errors.length) {
    const series = simulate(PB);
    world = {
      key_moments: beats.map((b, i) => ({ n: i + 1, t: b.t, title: b.title, values: valuesAt(PB, series, b.t) })),
      alerts: alertEvents(PB, series),
    };
    // a note should sit on a chart that visibly moves (a held-steady note or the last moment is fine)
    beats.forEach(b => (b.beat.notes || []).forEach(n => {
      const p = panels.find(p => p.id === n.panel); if (!p) return; const id = n.metric || p.metrics[0];
      const a = series[id][Math.max(0, b.t - 30)], c = series[id][Math.min(D, b.t + 10)];
      if (b !== beats[0] && b !== beats[beats.length - 1] && Math.abs(c - a) < 0.05 * Math.max(Math.abs(a), Math.abs(c), 1e-9)) warn(`t=${b.t}: note on ${n.panel} but ${id} barely changes in [t-30, t+10] (fine if the note says it held steady)`);
    }));
  }
  return { ok: !errors.length, errors, warnings, world };
}
