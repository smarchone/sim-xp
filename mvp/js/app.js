// The page: loads experience playbooks, runs the deterministic core, draws the dashboard,
// and exposes the same controls to agents through WebMCP (document.modelContext).

import { createSim, validatePlaybook, ACTIONS, FAULTS, METRICS } from './engine.js';
import { createPanel, clock } from './charts.js';

const $ = (id) => document.getElementById(id);
const WINDOW_S = 600;
const PANELS = [
  { title: 'Requests / s', series: [['rps', 'offered'], ['rps_ok', 'succeeded']], unit: 'req/s' },
  { title: 'Error rate', series: [['error_pct', '5xx + 429']], unit: '%' },
  { title: 'Latency', series: [['p50_ms', 'p50'], ['p99_ms', 'p99']], unit: 'ms' },
  { title: 'API CPU', series: [['api_cpu_pct', 'avg CPU']], unit: '%', max: 100 },
  { title: 'DB connections', series: [['db_conns', 'in use'], ['db_conn_limit', 'usable']], unit: '' },
  { title: 'API heap used', series: [['heap_pct', 'heap']], unit: '%', max: 100 },
  { title: 'GC pause', series: [['gc_pause_ms', 'avg pause']], unit: 'ms' },
  { title: 'DB query time', series: [['db_query_ms', 'avg query']], unit: 'ms' },
];

const playbooks = new Map();
let sim = null;
let running = false;
let driver = 'nobody'; // 'human' | 'agent'
let acc = 0;
let seenEvents = 0;

const panels = PANELS.map((p) => ({ ...p, view: createPanel($('panels'), p) }));

// ---------- Loading ----------

async function loadLibrary() {
  const ids = await (await fetch('playbooks/index.json')).json();
  for (const id of ids) playbooks.set(id, await (await fetch(`playbooks/${id}.json`)).json());
  refreshPicker(ids[0]);
  load(ids[0]);
}

function refreshPicker(selected) {
  $('playbook').innerHTML = [...playbooks.values()].map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
  $('playbook').value = selected;
}

function install(pb) {
  const errors = validatePlaybook(pb);
  if (errors.length) return errors;
  playbooks.set(pb.id, pb);
  refreshPicker(pb.id);
  load(pb.id);
  return [];
}

function load(id, seed) {
  const pb = playbooks.get(id);
  running = false;
  driver = 'nobody';
  sim = createSim(pb, seed ?? Number($('seed').value || pb.seed || 1));
  $('seed').value = sim.state.seed;
  seenEvents = 0;
  $('feed').innerHTML = '';
  $('debrief').close?.();
  $('briefing').innerHTML = `<p class="who">${esc(pb.author?.name || 'anonymous')} · ${esc(pb.rung || '')} · ${Math.round(pb.duration_s / 60)} min</p><p>${esc(pb.story)}</p>
    <p class="muted small">Graphs lag real time by ${sim.lag}s, like a real scrape pipeline. Dashed lines are alert thresholds; dotted verticals are deploys and changes.</p>`;
  $('runbook').innerHTML = (pb.runbook || []).map((r) => `<li><label><input type="checkbox"> <b>${esc(r.title)}</b></label><p>${esc(r.detail)}</p></li>`).join('');
  $('actions').innerHTML = pb.actions.map((a) => `<button data-action="${a}" title="Takes effect after ${ACTIONS[a].delay_s}s">${esc(ACTIONS[a].label)}<small>${ACTIONS[a].delay_s ? `${ACTIONS[a].delay_s}s` : 'now'}</small></button>`).join('');
  $('download').href = URL.createObjectURL(new Blob([JSON.stringify(pb, null, 2)], { type: 'application/json' }));
  $('download').download = `${pb.id}.json`;
  render();
}

// ---------- Real-time loop for humans ----------

setInterval(() => {
  if (running && sim && !sim.state.done) {
    acc += Number($('speed').value) / 10;
    while (acc >= 1) { sim.step(); acc -= 1; }
    render();
  }
}, 100);

function render() {
  const s = sim.state;
  const vis = sim.visible();
  const now = Math.max(0, s.t - sim.lag);
  const annotations = s.events.filter((e) => e.annotate && e.t <= now);
  for (const p of panels) {
    const keys = p.series.map(([k]) => k);
    const thresholds = (sim.pb.alerts || []).filter((a) => keys.includes(a.metric));
    p.view.draw({ samples: vis, now, windowS: WINDOW_S, thresholds, annotations });
  }
  const d = sim.debrief();
  const latest = vis[vis.length - 1] || {};
  const firing = sim.firingAlerts();
  const budgetClass = d.error_budget_left_pct > 50 ? 'good' : d.error_budget_left_pct > 0 ? 'warning' : 'critical';
  $('stats').innerHTML = [
    stat('Availability', `${d.availability_pct}%`, `SLO ${d.slo_pct}%`),
    stat('Error budget left', `${Math.max(0, d.error_budget_left_pct)}%`, budgetNote(d), budgetClass),
    stat('Pods ready', latest.api_ready != null ? `${latest.api_ready}` : '-', 'checkout tier'),
    stat('Cache hit', latest.cache_hit_pct != null ? `${Math.round(latest.cache_hit_pct)}%` : '-', 'read-through cache'),
    stat('Alerts firing', `${firing.length}`, firing.map((a) => a.summary).join(' · ') || 'all quiet', firing.some((a) => a.severity === 'critical') ? 'critical' : firing.length ? 'warning' : 'good'),
  ].join('');
  $('clock').textContent = `T+${clock(s.t)} / ${clock(sim.pb.duration_s)}`;
  $('mode').textContent = s.done ? 'drill over' : driver === 'agent' ? 'agent driving' : running ? 'live' : s.t ? 'paused' : 'ready';
  $('start').textContent = running ? 'Pause' : s.t && !s.done ? 'Resume' : 'Start';
  for (const e of s.events.slice(seenEvents)) feed(e);
  seenEvents = s.events.length;
  if (s.done && !$('debrief').open) showDebrief();
}

function budgetNote(d) {
  return d.error_budget_left_pct < 0 ? `overspent: ${((100 - d.error_budget_left_pct) / 100).toFixed(1)}x the budget` : 'for this drill';
}

function stat(label, value, sub, cls = '') {
  return `<div class="stat ${cls}"><span>${label}</span><b>${value}</b><small>${esc(sub)}</small></div>`;
}

function feed(e) {
  const li = document.createElement('li');
  li.className = `ev ${e.kind} ${e.severity || ''}`;
  const tag = { alert: e.severity === 'critical' ? 'CRIT' : 'WARN', resolved: 'OK', message: 'MSG', deploy: 'DEPLOY', action: 'YOU', effect: 'CHANGE', system: 'SYS' }[e.kind];
  li.innerHTML = `<time>${clock(e.t)}</time><span class="tag">${tag}</span><span>${e.from ? `<b>${esc(e.from)}:</b> ` : ''}${esc(e.text)}</span>`;
  $('feed').prepend(li);
}

function showDebrief() {
  const d = sim.debrief();
  const sec = (v) => (v == null ? '-' : `T+${clock(v)}`);
  $('debrief-body').innerHTML = `
    <div class="stats">${[
      stat('Availability', `${d.availability_pct}%`, `SLO ${d.slo_pct}%`),
      stat('Error budget left', `${Math.max(0, d.error_budget_left_pct)}%`, budgetNote(d)),
      stat('First alert', sec(d.first_alert_at_s), `impact began ${sec(d.incident_started_at_s)}`),
      stat('First fix attempt', sec(d.first_mitigation_at_s), ''),
      stat('Time to mitigate', d.time_to_mitigate_s != null ? `${Math.round(d.time_to_mitigate_s / 60 * 10) / 10} min` : 'not mitigated', 'errors < 1% for 60s, and stayed there'),
    ].join('')}</div>
    <h3>What the author did</h3>
    <table><tr><th>Step</th><th>Why</th><th>You</th></tr>${d.expert_path.map((e) => `<tr><td>${esc(ACTIONS[e.action].label)}</td><td>${esc(e.why)}</td><td>${e.you_at_s != null ? `T+${clock(e.you_at_s)}` : '<span class="muted">skipped</span>'}</td></tr>`).join('')}</table>
    ${d.pitfalls_hit.length ? `<h3>Traps you walked into</h3><ul>${d.pitfalls_hit.map((p) => `<li>${esc(p.text)}</li>`).join('')}</ul>` : ''}
    <h3>Lessons</h3><ul>${d.lessons.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${d.senior_note ? `<blockquote>${esc(d.senior_note)}<cite>${esc(sim.pb.author?.name || '')}</cite></blockquote>` : ''}`;
  $('debrief').showModal();
}

// ---------- Human controls ----------

$('start').addEventListener('click', () => {
  if (sim.state.done) load(sim.pb.id);
  driver = 'human';
  running = !running;
  render();
});
$('restart').addEventListener('click', () => load($('playbook').value));
$('playbook').addEventListener('change', () => load($('playbook').value, playbooks.get($('playbook').value).seed));
$('actions').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const r = sim.act(btn.dataset.action, {}, $('note').value.trim());
  if (!r.ok) { feed({ t: sim.state.t, kind: 'system', text: r.error }); return; }
  $('note').value = '';
  render();
});
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (!f) return;
  let pb;
  try { pb = JSON.parse(await f.text()); } catch (err) { alert(`Not valid JSON: ${err.message}`); return; }
  const errors = install(pb);
  if (errors.length) alert(`This playbook doesn't validate:\n- ${errors.join('\n- ')}`);
  $('file').value = '';
});
$('debrief-close').addEventListener('click', () => $('debrief').close());
$('debrief-again').addEventListener('click', () => load(sim.pb.id));

// ---------- WebMCP tools ----------

function summary() {
  const vis = sim.visible();
  const at = (secAgo) => vis[Math.max(0, vis.length - 1 - secAgo)] || {};
  const now = at(0), m1 = vis.slice(-60), m5 = at(300);
  const out = {};
  for (const k of Object.keys(METRICS)) {
    if (now[k] == null) continue;
    const avg = m1.reduce((a, s) => a + s[k], 0) / (m1.length || 1);
    out[k] = { now: round(now[k]), avg_1m: round(avg), five_min_ago: m5[k] != null ? round(m5[k]) : null, unit: METRICS[k].unit };
  }
  return out;
}

function snapshot(newEvents = []) {
  const s = sim.state;
  return {
    sim_time_s: s.t,
    duration_s: sim.pb.duration_s,
    done: s.done,
    note: `Dashboard data lags ${sim.lag}s behind sim time.`,
    new_events: newEvents.map((e) => ({ at_s: e.t, kind: e.kind, from: e.from, text: e.text })),
    firing_alerts: sim.firingAlerts(),
    pending_changes: s.pending.map((p) => ({ action: p.action, lands_at_s: p.at })),
    dashboard: summary(),
  };
}

const round = (v) => Math.round(v * 10) / 10;

const tools = [
  {
    name: 'list_playbooks',
    description: 'List the experience playbooks (incident drills encoded by senior engineers) loaded in this page.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => [...playbooks.values()].map((p) => ({ id: p.id, title: p.title, author: p.author?.name, rung: p.rung, tags: p.tags, duration_s: p.duration_s })),
  },
  {
    name: 'start_drill',
    description: 'Load a playbook and start it in agent mode. Time is frozen between your calls and only moves when you call advance. Returns the briefing, the actions you can take, and the first dashboard snapshot.',
    inputSchema: { type: 'object', properties: { playbook_id: { type: 'string' }, seed: { type: 'number', description: 'Optional. Same seed + same actions = same run.' } }, required: ['playbook_id'] },
    async execute({ playbook_id, seed }) {
      if (!playbooks.has(playbook_id)) return { error: `Unknown playbook. Known: ${[...playbooks.keys()].join(', ')}` };
      $('playbook').value = playbook_id;
      load(playbook_id, seed);
      driver = 'agent';
      render();
      return {
        title: sim.pb.title, story: sim.pb.story, seed: sim.state.seed,
        actions: sim.pb.actions.map((a) => ({ id: a, label: ACTIONS[a].label, takes_effect_after_s: ACTIONS[a].delay_s, params: ACTIONS[a].params })),
        how_to_play: 'Call advance to let time pass (it stops early when an alert fires or someone messages you). Read the dashboard, use query_metrics for history, act with take_action. When the drill is over, call get_debrief. The runbook (get_runbook) is the author\'s advice: try without it first.',
        ...snapshot(),
      };
    },
  },
  {
    name: 'advance',
    description: 'Let simulated time pass. Stops early when a new alert fires or a message arrives (unless stop_on_event is false). Returns what happened and the dashboard.',
    inputSchema: { type: 'object', properties: { seconds: { type: 'number', description: '1 to 300' }, stop_on_event: { type: 'boolean' } }, required: ['seconds'] },
    async execute({ seconds, stop_on_event = true }) {
      if (!sim) return { error: 'Call start_drill first.' };
      driver = 'agent';
      running = false;
      const before = sim.state.events.length;
      const n = Math.max(1, Math.min(300, Math.round(seconds)));
      for (let i = 0; i < n && !sim.state.done; i++) {
        const k = sim.state.events.length;
        sim.step();
        if (stop_on_event && sim.state.events.slice(k).some((e) => e.kind === 'alert' || e.kind === 'message')) break;
      }
      render();
      return snapshot(sim.state.events.slice(before));
    },
  },
  {
    name: 'query_metrics',
    description: 'History for some metrics, as seen on the dashboard (lagged). Use it to look at shape and slope, not just the latest value.',
    inputSchema: {
      type: 'object',
      properties: { metrics: { type: 'array', items: { type: 'string', enum: Object.keys(METRICS) } }, window_s: { type: 'number' }, step_s: { type: 'number' } },
      required: ['metrics'],
    },
    annotations: { readOnlyHint: true },
    async execute({ metrics, window_s = 300, step_s = 15 }) {
      const bad = metrics.filter((m) => !METRICS[m]);
      if (bad.length) return { error: `Unknown metrics: ${bad.join(', ')}. Known: ${Object.keys(METRICS).join(', ')}` };
      const vis = sim.visible().filter((s) => s.t > sim.state.t - sim.lag - window_s);
      const rows = vis.filter((s, i) => i % Math.max(1, Math.round(step_s)) === 0 || i === vis.length - 1);
      return { columns: ['t', ...metrics], rows: rows.map((s) => [s.t, ...metrics.map((m) => round(s[m]))]) };
    },
  },
  {
    name: 'take_action',
    description: 'Do something to the system. Changes land after their delay, like real ones. Give a short reason; it shows in the feed and the debrief.',
    inputSchema: { type: 'object', properties: { action: { type: 'string' }, params: { type: 'object' }, reason: { type: 'string' } }, required: ['action'] },
    async execute({ action, params = {}, reason = '' }) {
      if (!sim) return { error: 'Call start_drill first.' };
      const r = sim.act(action, params, reason);
      render();
      return r;
    },
  },
  {
    name: 'get_runbook',
    description: "The playbook author's runbook for this drill: their advice, written from experience.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => sim?.pb.runbook || [],
  },
  {
    name: 'get_debrief',
    description: 'Outcome scores, your actions next to what the author did, traps you hit, and the lessons. Most useful once the drill is over.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => (sim ? sim.debrief() : { error: 'No drill loaded.' }),
  },
  {
    name: 'get_playbook_format',
    description: 'How to write a playbook: the JSON fields, plus the faults, actions and metrics the engine supports. Use it to turn a senior engineer\'s story or a postmortem into a playable drill.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async execute() {
      return {
        example: playbooks.get('flash-sale-pool-exhaustion'),
        faults: FAULTS,
        actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { label: a.label, delay_s: a.delay_s, params: a.params }])),
        metrics: METRICS,
        rules: [
          'Faults change the system, not the graphs. Pick faults and timing that make the real dynamics show up.',
          'Add at least one red herring (a message or an unrelated alert). Real incidents have them.',
          'debrief.expert_path is what you actually did and why. debrief.pitfalls are the tempting moves that make it worse.',
          'Test it: install_playbook, then play it once yourself with advance/take_action.',
        ],
      };
    },
  },
  {
    name: 'install_playbook',
    description: 'Validate a playbook JSON and load it into the page. Returns validation errors if it does not fit the engine.',
    inputSchema: { type: 'object', properties: { playbook: { type: 'object' } }, required: ['playbook'] },
    async execute({ playbook }) {
      const errors = install(playbook);
      return errors.length ? { ok: false, errors } : { ok: true, id: playbook.id, note: 'Loaded and selected. Use start_drill to play it.' };
    },
  },
];

if ('modelContext' in document) {
  Promise.all(tools.map((t) => document.modelContext.registerTool(t)))
    .then(() => ($('webmcp').textContent = `${tools.length} WebMCP tools`))
    .catch((err) => ($('webmcp').textContent = `WebMCP error: ${err.message}`));
} else {
  $('webmcp').textContent = 'no WebMCP in this browser';
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

loadLibrary().catch((err) => {
  $('briefing').innerHTML = `<p class="bad">Could not load playbooks (${esc(err.message)}). Serve this folder over http, e.g. <code>npx serve mvp</code>.</p>`;
});
