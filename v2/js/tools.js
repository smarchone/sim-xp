// WebMCP tools for the v2 page. An agent (Claude Code through the WebMCP bridge) writes a playbook with the
// story-to-playbook skill, then checks, loads and plays it here, and reads the world back with get_state.
// The page can't read files: the bridge replaces a {"$file": "path"} argument with the file's text.
import { SCHEMA, validate, simulate, alertEvents, valuesAt } from "./playbook.js";

const GUIDE = {
  what: "sim-xp plays a playbook: a scripted, deterministic run of a small system. The viewer watches components, dashboards and a feed move, and playback pauses at key moments that explain what happened. A report closes the run.",
  schema: SCHEMA,
  how_to_write: "Use the story-to-playbook skill (install: npx degit smarchone/sim-xp/.claude/skills/story-to-playbook ~/.claude/skills/story-to-playbook --force). It has the format, the rules, examples and the validator. Bundled playbooks are complete references: list_playbooks, then get_playbook after loading one.",
  passing_files: 'Write the playbook to a file and pass {"$file": "path/to/playbook.json"} as the playbook argument: the bridge inlines the file, so the JSON stays out of the conversation. Paths resolve against the folder Claude Code runs in.',
  workflow: [
    "validate_playbook with the file. Fix every error; read world.key_moments and world.alerts and check that the numbers tell the story (e.g. lag rises before its alert fires). Fix and validate again.",
    "load_playbook. The page shows the story first; the person presses Space to start, or pass autoplay: true when they asked you to start it.",
    "The person watches. Don't drive playback unless asked. Playback pauses at each key moment until the person continues.",
    "To look at the world yourself, call get_state with t (any second) without moving playback, or wait_for a key moment or the end.",
    "Finish with one or two lines: what is playing and how to watch (Space to play or pause, arrow keys between key moments, R for the report).",
  ],
};

const fail = (msg) => { throw new Error(msg); };
function checkArgs(input, allowed) {
  const extra = Object.keys(input || {}).filter((k) => !allowed.includes(k));
  if (extra.length) fail(`unknown argument(s) ${extra.join(", ")}; this tool takes ${allowed.length ? allowed.join(", ") : "no arguments"}`);
}

// What the world looks like at second t, computed from the playbook (no noise; the charts add jitter).
function worldAt(pb, t) {
  const D = pb.meta.duration_s; t = Math.max(0, Math.min(D, Math.round(t)));
  const series = simulate(pb);
  const comps = {};
  const apply = (eff) => { const cur = comps[eff.target] || {}; for (const k in eff) if (k !== "target") { if (eff[k] === null) delete cur[k]; else cur[k] = eff[k]; } comps[eff.target] = cur; };
  (pb.initial?.effects || []).forEach(apply);
  pb.timeline.forEach((e) => { if (e.t <= t) (e.effects || []).forEach(apply); });
  for (const k in comps) if (!Object.keys(comps[k]).length) delete comps[k];
  const firing = new Set();
  for (const ev of alertEvents(pb, series)) if (ev.t <= t) { if (ev.event === "fires") firing.add(ev.alert); else firing.delete(ev.alert); }
  const beats = pb.timeline.filter((e) => e.beat);
  const passed = beats.filter((b) => b.t <= t);
  const feed = pb.timeline.filter((e) => e.feed && e.t <= t).slice(-5).map((e) => ({ t: e.t, from: e.feed.from, text: e.feed.text }));
  return {
    t,
    chapter: passed.length ? { n: passed.length, title: passed[passed.length - 1].title } : null,
    values: valuesAt(pb, series, t),
    alerts_firing: (pb.alerts || []).filter((a) => firing.has(a.id)).map((a) => ({ id: a.id, severity: a.severity, component: a.component, summary: a.summary })),
    components: comps,
    recent_feed: feed,
  };
}

export function buildTools(ctx) {
  const requireLoaded = () => ctx.simxp.current || fail("no playbook is loaded; call load_playbook first");
  const requirePlayer = () => ctx.player() || fail("the player is still starting; try again");
  const state = (t) => {
    const pb = requireLoaded(), p = ctx.player();
    const status = p ? p.status() : { t: 0, playing: false, intro_open: true };
    return { playbook: pb.meta.id, duration_s: pb.meta.duration_s, playback: status, world: worldAt(pb, t ?? status.t) };
  };
  const PLAYBOOK = { description: 'The playbook: {"$file": "path/to/playbook.json"} (the bridge inlines the file), or the JSON object itself' };

  return [
    {
      name: "get_guide",
      description: "Start here. What this page does, how to pass a playbook file, and the workflow: validate, load, let the person watch, read the world with get_state.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async (input) => { checkArgs(input, []); return { ...GUIDE, loaded: ctx.simxp.current ? ctx.simxp.current.meta.id : null }; },
    },
    {
      name: "list_playbooks",
      description: "The playbooks bundled with the page (id, title, story, length). Load one with load_playbook { id }.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async (input) => { checkArgs(input, []); return { playbooks: ctx.index().map(({ file, ...p }) => p), loaded: ctx.simxp.current ? ctx.simxp.current.meta.id : null }; },
    },
    {
      name: "validate_playbook",
      description: "Check a playbook without loading it. Returns errors (must fix), warnings (judge them), and the world at each key moment plus when each alert fires and resolves, so you can see whether the numbers tell the story. Pass at: [seconds] to see more moments.",
      inputSchema: { type: "object", properties: { playbook: PLAYBOOK, at: { type: "array", items: { type: "number" }, description: "Extra seconds to report the metric values at" } }, required: ["playbook"] },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        checkArgs(input, ["playbook", "at"]);
        const pb = ctx.parsePlaybook(input.playbook);
        const r = validate(pb);
        if (r.ok && input.at) { const s = simulate(pb); r.world.at = input.at.map((t) => ({ t, values: valuesAt(pb, s, t) })); }
        return r;
      },
    },
    {
      name: "load_playbook",
      description: "Load a playbook into the player and show its story. Pass playbook (a file or JSON), or id for a bundled one. It is validated first and nothing changes if it has errors. autoplay: true starts it right away; otherwise the person presses Space.",
      inputSchema: { type: "object", properties: { playbook: PLAYBOOK, id: { type: "string", description: "A bundled playbook id from list_playbooks" }, autoplay: { type: "boolean" } } },
      execute: async (input) => {
        checkArgs(input, ["playbook", "id", "autoplay"]);
        if (!input.playbook === !input.id) fail("pass exactly one of playbook or id");
        const pb = input.id ? await ctx.fetchBundled(input.id) : ctx.parsePlaybook(input.playbook);
        const r = validate(pb);
        if (!r.ok) return { loaded: false, errors: r.errors, warnings: r.warnings, hint: "Fix the errors and call load_playbook again." };
        await ctx.loadPlaybook(pb, input.id ? "library:" + input.id : "agent");
        if (input.autoplay) requirePlayer().start();
        const beats = pb.timeline.filter((e) => e.beat);
        return {
          loaded: true, id: pb.meta.id, title: pb.meta.title, duration_s: pb.meta.duration_s,
          key_moments: beats.map((b, i) => ({ n: i + 1, t: b.t, title: b.title })),
          warnings: r.warnings, playing: !!input.autoplay,
          watch: "Space plays and pauses (and continues past a key moment), ←/→ jump between key moments, R opens the report.",
        };
      },
    },
    {
      name: "control",
      description: "Drive playback when the person asks you to. action: start (close the story and play), play, pause, seek (with t), key_moment (with n, 1-based), next, prev, report, close_report, restart, speed (with speed 0.5, 1, 2 or 4). Returns the new state.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "play", "pause", "seek", "key_moment", "next", "prev", "report", "close_report", "restart", "speed"] },
          t: { type: "number" }, n: { type: "integer" }, speed: { type: "number" },
        },
        required: ["action"],
      },
      execute: async (input) => {
        checkArgs(input, ["action", "t", "n", "speed"]);
        requireLoaded(); const p = requirePlayer();
        switch (input.action) {
          case "start": case "play": p.start(); break;
          case "pause": p.pause(); break;
          case "seek": if (typeof input.t !== "number") fail("seek needs t (seconds)"); p.seek(input.t); break;
          case "key_moment": if (!Number.isInteger(input.n)) fail("key_moment needs n (1-based)"); p.keyMoment(input.n); break;
          case "next": p.step(1); break;
          case "prev": p.step(-1); break;
          case "report": p.report(true); break;
          case "close_report": p.report(false); break;
          case "restart": p.restart(); break;
          case "speed": p.speed(input.speed); break;
          default: fail(`unknown action ${input.action}`);
        }
        return state();
      },
    },
    {
      name: "get_state",
      description: "Where playback is (time, playing, paused at a key moment, story or report open) and what the world looks like: metric values, firing alerts, component effects and the latest feed lines. Pass t to look at any second without moving playback.",
      inputSchema: { type: "object", properties: { t: { type: "number", description: "Second to look at; default: the playback position" } } },
      annotations: { readOnlyHint: true },
      execute: async (input) => { checkArgs(input, ["t"]); return state(input.t); },
    },
    {
      name: "wait_for",
      description: "Wait while the person watches, until playback pauses at a key moment or reaches the end (or timeout_s passes, default 120, max 600). Returns what happened and the state then. Waiting costs no tokens.",
      inputSchema: { type: "object", properties: { until: { type: "string", enum: ["key_moment", "end"] }, timeout_s: { type: "number" } }, required: ["until"] },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        checkArgs(input, ["until", "timeout_s"]);
        requireLoaded();
        const ms = Math.max(1, Math.min(600, input.timeout_s ?? 120)) * 1000;
        const ev = await ctx.waitFor((type) => type === input.until || type === "end", ms);
        return { ...ev, ...(ctx.simxp.current ? state() : { loaded: null }) };
      },
    },
    {
      name: "get_playbook",
      description: "The loaded playbook's full JSON, e.g. to save a good run as a file or to edit it and load it again.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async (input) => { checkArgs(input, []); return requireLoaded(); },
    },
  ];
}
