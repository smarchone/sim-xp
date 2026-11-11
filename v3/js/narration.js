// sim-xp narration: every sentence the narrator says, derived from the playbook alone. The one copy of this logic: the player
// uses it to speak (the build inlines it into player.html), and v3/tools/gen-audio.mjs uses it to record, with no browser. The
// recording is keyed by the exact spoken text, so the two must never differ; v3/test/narration.test.mjs pins the output.
import { simulate } from "./playbook.js";

// ---------- text for the ear ----------
const ORD = (n) => n + (/1[123]$/.test(n) ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n.slice(-1)] || "th");
const UNITS = { ms: "milliseconds", "µs": "microseconds", us: "microseconds", ns: "nanoseconds", s: "seconds", sec: "seconds", min: "minutes", h: "hours", hr: "hours",
  "KB/s": "kilobytes per second", "MB/s": "megabytes per second", "GB/s": "gigabytes per second", KB: "kilobytes", MB: "megabytes", GB: "gigabytes", TB: "terabytes",
  rps: "requests per second", RPS: "requests per second", qps: "queries per second", QPS: "queries per second", "/s": "per second", k: "thousand", K: "thousand", M: "million" };
// written text to spoken text: units, percentiles and code names read the way an engineer would say them
export function spoken(t) {
  return String(t || "")
    .replace(/[`*]{1,2}(?=\S)|(?<=\S)[`*]{1,2}|(?<!\w)_{1,2}(?=\S)|(?<=\S)_{1,2}(?!\w)/g, "")   // markdown marks; an underscore inside a word (pg_stat_activity) stays
    .replace(/\be\.g\.,?/gi, "for example,").replace(/\bi\.e\.,?/gi, "that is,").replace(/\betc\./gi, "and so on.").replace(/\bvs\.?(?=\s)/gi, "versus")
    .replace(/\bp50\b/gi, "median").replace(/\bp(99)(9)\b/gi, "99.9th percentile").replace(/\bp(\d{2})\b/gi, (_, n) => ORD(n) + " percentile")
    .replace(/(\d[\d,.]*)\s?(KB\/s|MB\/s|GB\/s|µs|us|ns|ms|sec|min|hr|KB|MB|GB|TB|rps|RPS|qps|QPS|\/s|[shkKM])(?![\w.]*\d)\b/g, (_, n, u) => n + " " + (n === "1" ? UNITS[u].replace(/s(?= per|$)/, "") : UNITS[u]))
    .replace(/\b(KB|MB|GB)\/s\b/g, (_, u) => UNITS[u + "/s"]).replace(/(\d+)(?:\/(\d+))+/g, (m) => m.split("/").join(", ")).replace(/\s*=\s*/g, " equals ")
    .replace(/(\d)\s?\/s\b/g, "$1 per second").replace(/(\d)\s?%/g, "$1 percent")
    .replace(/#(\d)/g, "number $1").replace(/\s*&\s*/g, " and ").replace(/<\s?(?=\d)/g, "under ").replace(/>\s?(?=\d)/g, "over ")
    .replace(/\b[a-z][a-z0-9]*(?:[._][a-z][a-z0-9]*)+\b/gi, (w) => w.replace(/\.(ms|s)$/i, "").replace(/[._]/g, " "))   // max.poll.interval.ms: "max poll interval"
    .replace(/\s*→\s*/g, " to ").replace(/(\d)\s*×/g, "$1 times").replace(/×/g, " times ").replace(/\s*[≈~]\s*(?=\d)/g, " about ")
    .replace(/\(\s*\)/g, "").replace(/\s*[—–]\s*/g, ", ").replace(/\s*\(([^)]*)\)/g, ", $1,").replace(/,\s*([.!?;:])/g, "$1").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
}
export const sentence = (t) => { t = String(t || "").trim(); return !t || /[.!?…:]$/.test(t) ? t : t + "."; };
// an explanation, one sentence per item (a key moment is read, and shown, sentence by sentence)
export const toPoints = (t) => String(t || "").split(/(?<=[.!?])\s+(?=[A-Z0-9'"(“‘])/).map((x) => x.trim()).filter(Boolean);
export const andList = (xs) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

// ---------- numbers as the dashboard shows them ----------
export const unitOf = (u) => (!u || u === "count" || u === "ms" ? "" : u);
export const kfmt = (v) => (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, "") + "k";
export const fmtV = (v, unit) => unit === "count" ? String(Math.round(v)) : unit === "ms" ? (v >= 1000 ? (v / 1000).toFixed(2).replace(/0$/, "") + "s" : Math.round(v) + "ms") : v >= 1000 ? kfmt(v) : String(Math.round(v));
export const withUnit = (v, u) => { const n = fmtV(v, u), k = unitOf(u); return k === "%" ? n + "%" : k ? `${n} ${k}` : n; };

// ---------- what the narrator says ----------
const metricOf = (PB) => Object.fromEntries(PB.metrics.map((m) => [m.id, m]));
// a dashboard entry is an event lane (not a chart) when all its series are counts
export const isEvent = (PB, p) => { const byId = metricOf(PB); return p.metrics.every((m) => byId[m].unit === "count"); };
// the charts to watch (meta.watch), each matched to a Standard chart: by `panel` id, else its title, a series label, or a title that
// contains it. Unmatched entries are dropped and a chart is listed once, so the numbering is the board's.
export function watchCharts(PB) {
  const byId = metricOf(PB), norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const charts = PB.dashboard.filter((p) => !isEvent(PB, p) && p.level !== "deep"), out = [];
  for (const w of PB.meta.watch || []) {
    const k = norm(w.label);
    const p = (w.panel && charts.find((c) => c.id === w.panel)) || charts.find((c) => norm(c.title) === k) || charts.find((c) => c.metrics.some((m) => norm(byId[m].label) === k))
      || charts.find((c) => norm(c.title).includes(k) || k.includes(norm(c.title)));
    if (p && !out.some((o) => o.panel === p)) out.push({ panel: p, label: w.label, normal: w.normal });
  }
  return out;
}
const watchSentence = (W) => `Keep an eye on ${W.map((w, i) => `chart ${i + 1}, ${w.label}`).join("; and ")}.`;
// the intro of a run (Read): the title, then the charts to watch
export const introLines = (PB) => { const W = watchCharts(PB); return [sentence(PB.meta.title), ...(W.length ? [watchSentence(W)] : [])]; };
export const keyMoments = (PB) => PB.timeline.filter((e) => e.beat);
// a key moment: its number, title and explanation (and, in Hardcore, its deep note)
export const beatLines = (PB, e, hardcore) => [`Key moment ${keyMoments(PB).indexOf(e) + 1}.`, sentence(e.title), ...toPoints(e.beat.hint), ...(hardcore && e.beat.deep ? toPoints(e.beat.deep) : [])];
// a stat on the numbers slide: peak (or low) vs the end; delta = how much it moved before vs after the fix
export function statVals(PB, series, st) {
  const D = PB.meta.duration_s, R = PB.report, s = series[st.metric], f = Number.isInteger(R.fix_t) ? R.fix_t : D;
  if (st.agg === "delta") return [s[f] - s[0], s[D] - s[f]];
  if (st.agg === "min") return [Math.min(...s), s[D]];
  return [Math.max(...s), s[D]];
}
// the result deck, one slide per idea, each with what is said on it (the player adds what is shown)
export function resultSlides(PB, hardcore, series = simulate(PB)) {
  const R = PB.report;
  return [
    { kind: "what", v: ["What happened.", R.tldr] },
    R.stats.length ? { kind: "numbers", v: ["The numbers.", ...R.stats.map((st) => { const [b, a] = statVals(PB, series, st); return `${sentence(st.label).slice(0, -1)}: ${withUnit(b, st.unit)} at worst, and ${withUnit(a, st.unit)} at the end.`; })] } : null,
    ...R.learnings.map((l, i) => ({ kind: "takeaway", i, v: [`Takeaway ${i + 1}.`, sentence(l.title), l.body] })),
    (R.chain || []).length ? { kind: "chain", v: ["How it happened.", ...R.chain.map((c) => sentence(c.text))] } : null,
    R.math ? { kind: "math", v: [sentence(R.math.title || "The arithmetic"), "The working is on screen."] } : null,
    (R.myths || []).length ? { kind: "myths", v: ["Some common myths.", ...R.myths.flatMap((m) => [`Myth: ${sentence(m.myth)}`, m.truth])] } : null,
    hardcore && R.deep && ((R.deep.config || []).length || (R.deep.runbook || []).length) ? { kind: "deep", v: ["Deep dive: the config involved, and what to check next time."] } : null,
    (R.links || []).length ? { kind: "links", v: ["To read more, the links are on screen."] } : null,
  ].filter(Boolean);
}
// Watch's opening slides, before the run: the title, each background block, the system, the charts to watch
export function openingScenes(PB) {
  const M = PB.meta, bg = (M.background || []).map((b) => (typeof b === "string" ? { body: b } : b)), names = PB.components.nodes.map((n) => n.label), W = watchCharts(PB);
  return [
    { kind: "intro", lines: [sentence(M.title), M.story] },
    ...bg.map((b) => ({ kind: "bg", b, lines: [...(b.title ? [sentence(b.title)] : []), b.body] })),
    { kind: "system", lines: [names.length && names.length <= 7 ? `Here is the system: ${andList(names)}.` : "Here is the system we will watch."] },
    ...(W.length ? [{ kind: "watch", lines: [watchSentence(W)] }] : []),
  ];
}
const hasDeepBeats = (PB) => PB.dashboard.some((p) => p.level === "deep") || PB.timeline.some((e) => (e.feed && e.feed.level === "deep") || (e.beat && e.beat.deep))
  || PB.components.nodes.some((n) => (n.details || []).some((d) => d.level === "deep")) || !!(PB.report && PB.report.deep);
// every sentence the narrator can say for this playbook, as spoken, once each: Standard and Hardcore, Watch and Read.
// This is what gen-audio records and what the player looks up.
export function narration(PB) {
  const L = ["Voice on.", "That is the whole run.", "The result is below the player.", ...introLines(PB)];
  for (const hc of hasDeepBeats(PB) ? [false, true] : [false]) keyMoments(PB).forEach((e) => L.push(...beatLines(PB, e, hc)));
  for (const s of openingScenes(PB)) L.push(...s.lines);
  for (const s of resultSlides(PB, false)) L.push(...s.v);
  return [...new Set(L.map(spoken).filter(Boolean))];
}
