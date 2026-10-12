// Deterministic simulation core. No DOM, no wall clock: one step() is one simulated second.
// The same playbook + seed + action log always produces the same run.
//
// The model is deliberately small: edge -> API pods -> cache -> DB. It has the primitives that make
// incidents feel real (saturation, queueing, retries that amplify load, connection pools, GC pressure),
// and playbooks compose those primitives instead of scripting metric values.

export const METRICS = {
  rps: { label: 'Requests offered', unit: 'req/s' },
  rps_ok: { label: 'Requests succeeded', unit: 'req/s' },
  error_pct: { label: 'Error rate (5xx + 429)', unit: '%' },
  p50_ms: { label: 'Latency p50', unit: 'ms' },
  p99_ms: { label: 'Latency p99', unit: 'ms' },
  api_cpu_pct: { label: 'API CPU', unit: '%' },
  api_ready: { label: 'API pods ready', unit: 'pods' },
  db_conns: { label: 'DB connections in use', unit: 'conns' },
  db_conn_limit: { label: 'DB connections usable', unit: 'conns' },
  db_query_ms: { label: 'DB query time', unit: 'ms' },
  heap_pct: { label: 'API heap used', unit: '%' },
  gc_pause_ms: { label: 'GC pause', unit: 'ms' },
  cache_hit_pct: { label: 'Cache hit ratio', unit: '%' },
};

const DEFAULT_SYSTEM = {
  traffic: { base_rps: 800, noise: 0.03 },
  api: { replicas: 4, rps_per_replica: 300, pool_size: 20, base_latency_ms: 40, timeout_ms: 3000, heap_start_pct: 55, heap_mb: 1024, retry_attempts: 2 },
  cache: { hit_ratio: 0.9 },
  db: { max_connections: 100, query_ms: 20, queries_per_miss: 5 },
};

// Faults a playbook can start on its timeline. They change the system, never a metric directly.
export const FAULTS = {
  traffic_spike: { params: { multiplier: 'number', ramp_s: 'number' }, about: 'Traffic ramps to base * multiplier.' },
  cache_degrade: { params: { hit_ratio: 'number' }, about: 'Cache hit ratio drops (cold keys, eviction, a flush).' },
  slow_query: { params: { factor: 'number' }, about: 'Every DB query takes factor times longer.' },
  memory_leak: { params: { mb_per_s: 'number' }, about: 'API heap grows under load until GC thrashes and pods OOM.' },
  bad_deploy: { params: { error_pct: 'number' }, about: 'A share of requests fail outright.' },
};

// Operator actions. A playbook lists which ones the learner gets. Effects land after delay_s,
// like real changes do.
export const ACTIONS = {
  rate_limit: {
    label: 'Enable rate limit at the edge', delay_s: 10, params: { rps: 'number' },
    run(s, sys, p) { s.rateLimit = p.rps ?? Math.round(s.replicas * sys.api.rps_per_replica * 0.9); return `edge now admits ${s.rateLimit} req/s`; },
  },
  remove_rate_limit: { label: 'Remove edge rate limit', delay_s: 10, run(s) { s.rateLimit = null; return 'edge rate limit removed'; } },
  scale_api: {
    label: 'Scale API +2 pods', delay_s: 45, params: { by: 'number' },
    run(s, sys, p) { s.replicas += p.by ?? 2; return `API now has ${s.replicas} pods`; },
  },
  right_size_pool: {
    label: 'Right-size DB pool per pod', delay_s: 30,
    run(s) { s.pool = Math.max(4, Math.floor((s.dbMax * 0.9) / s.replicas)); return `pool is now ${s.pool} per pod (${s.pool * s.replicas} total vs DB max ${s.dbMax})`; },
  },
  disable_retries: { label: 'Switch clients to backoff + jitter', delay_s: 20, run(s) { s.retries = false; return 'client retries now back off'; } },
  warm_cache: {
    label: 'Pre-warm cache for hot keys', delay_s: 60,
    run(s, sys) { delete s.faults.cache_degrade; s.hit = sys.cache.hit_ratio; return `cache hit ratio back to ${Math.round(s.hit * 100)}%`; },
  },
  restart_api: {
    label: 'Rolling restart of API pods', delay_s: 0,
    run(s, sys) {
      const half = Math.ceil(s.replicas / 2);
      for (let i = 0; i < half; i++) s.restarting.push(s.t + 30);
      for (let i = half; i < s.replicas; i++) s.restarting.push(s.t + 60);
      s.heap = sys.api.heap_start_pct;
      return 'pods restarting in two waves';
    },
  },
  rollback: {
    label: 'Roll back the last deploy', delay_s: 90,
    run(s, sys) { delete s.faults.bad_deploy; delete s.faults.memory_leak; s.heap = sys.api.heap_start_pct; return 'previous version is live on all pods'; },
  },
  add_index: { label: 'Ship the missing DB index', delay_s: 120, run(s) { delete s.faults.slow_query; return 'index built, query plans fixed'; } },
  post_update: { label: 'Post a status update', delay_s: 0, comms: true, run() { return 'status update posted to #incident'; } },
  declare_incident: { label: 'Declare an incident', delay_s: 0, comms: true, run() { return 'incident declared, roles assigned'; } },
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) out[k] = typeof v === 'object' && !Array.isArray(v) ? { ...out[k], ...v } : v;
  return out;
}

export function validatePlaybook(pb) {
  const errors = [];
  if (!pb || typeof pb !== 'object') return ['playbook must be a JSON object'];
  for (const k of ['id', 'title', 'story', 'duration_s', 'timeline', 'actions']) if (pb[k] == null) errors.push(`missing "${k}"`);
  if (pb.id && !/^[a-z0-9-]+$/.test(pb.id)) errors.push('"id" must be lowercase letters, digits and dashes');
  if (pb.duration_s && (pb.duration_s < 60 || pb.duration_s > 3600)) errors.push('"duration_s" must be 60..3600');
  for (const [i, ev] of (pb.timeline || []).entries()) {
    if (typeof ev.at !== 'number') errors.push(`timeline[${i}]: "at" must be a number of seconds`);
    if (ev.fault && !FAULTS[ev.fault]) errors.push(`timeline[${i}]: unknown fault "${ev.fault}" (known: ${Object.keys(FAULTS).join(', ')})`);
    if (ev.clear && !FAULTS[ev.clear]) errors.push(`timeline[${i}]: unknown fault to clear "${ev.clear}"`);
    if (!ev.fault && !ev.clear && !ev.message && !ev.deploy) errors.push(`timeline[${i}]: needs one of fault, clear, message, deploy`);
  }
  for (const a of pb.actions || []) if (!ACTIONS[a]) errors.push(`unknown action "${a}" (known: ${Object.keys(ACTIONS).join(', ')})`);
  for (const [i, al] of (pb.alerts || []).entries()) {
    if (!METRICS[al.metric]) errors.push(`alerts[${i}]: unknown metric "${al.metric}"`);
    if (!['>', '<'].includes(al.op)) errors.push(`alerts[${i}]: op must be ">" or "<"`);
  }
  for (const [i, e] of (pb.debrief?.expert_path || []).entries()) if (!ACTIONS[e.action]) errors.push(`debrief.expert_path[${i}]: unknown action "${e.action}"`);
  for (const [i, e] of (pb.debrief?.pitfalls || []).entries()) if (!ACTIONS[e.action]) errors.push(`debrief.pitfalls[${i}]: unknown action "${e.action}"`);
  return errors;
}

export function createSim(pb, seed = pb.seed ?? 1) {
  const sys = merge(DEFAULT_SYSTEM, pb.system);
  const rand = mulberry32(seed);
  const gauss = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const lag = pb.scrape_lag_s ?? 15;
  const slo = pb.slo?.availability ?? 0.99;

  const s = {
    t: 0, seed, done: false,
    replicas: sys.api.replicas, restarting: [], pool: sys.api.pool_size, dbMax: sys.db.max_connections,
    heap: sys.api.heap_start_pct, hit: sys.cache.hit_ratio, retries: true, rateLimit: null,
    faults: {}, pending: [], errPrev: 0,
    samples: [], events: [], actions: [], alerts: {},
    req: 0, err: 0, incidentStart: null, firstAlertAt: null, okSince: null, mitigatedAt: null,
  };

  const log = (kind, text, extra = {}) => { const e = { t: s.t, kind, text, ...extra }; s.events.push(e); return e; };

  function applyTimeline(ev) {
    if (ev.unless_action && s.actions.some((a) => a.action === ev.unless_action)) return;
    if (ev.deploy) log('deploy', ev.deploy, { annotate: true });
    if (ev.message) log('message', ev.message, { from: ev.from || 'someone' });
    if (ev.fault) s.faults[ev.fault] = { ...ev.params, started: s.t };
    if (ev.clear) delete s.faults[ev.clear];
  }

  function step() {
    if (s.done) return;
    const t = ++s.t;
    for (const ev of pb.timeline) if (ev.at === t) applyTimeline(ev);
    applyDue();
    s.restarting = s.restarting.filter((at) => at > t);

    // Load
    const sp = s.faults.traffic_spike;
    const mult = sp ? 1 + (sp.multiplier - 1) * Math.min(1, (t - sp.started) / (sp.ramp_s || 1)) : 1;
    const traffic = sys.traffic.base_rps * mult * (1 + 0.04 * Math.sin(t / 90)) * (1 + sys.traffic.noise * gauss());
    const retryF = s.retries ? Math.min(3, 1 + sys.api.retry_attempts * s.errPrev) : 1 + 0.1 * s.errPrev;
    const offered = traffic * retryF;
    const admitted = s.rateLimit ? Math.min(offered, s.rateLimit) : offered;
    const shed = offered - admitted;
    if (s.faults.cache_degrade) s.hit = s.faults.cache_degrade.hit_ratio;

    // API pods: heap and GC
    const ready = Math.max(0, s.replicas - s.restarting.length);
    const perPodLoad = ready ? admitted / (ready * sys.api.rps_per_replica) : 0;
    const leak = s.faults.memory_leak?.mb_per_s || 0;
    s.heap += ((leak * Math.min(perPodLoad, 2)) / sys.api.heap_mb) * 100;
    const h = s.heap / 100;
    const gcFrac = h < 0.75 ? 0.02 : 0.02 + 0.7 * ((h - 0.75) / 0.25) ** 2;
    if (s.heap >= 100 && ready > 0) {
      s.restarting.push(t + 30);
      s.heap = 88;
      log('system', 'api pod OOMKilled, restarting');
    }
    const apiCap = Math.max(1, ready * sys.api.rps_per_replica * (1 - Math.min(gcFrac, 0.9)));
    const apiSat = admitted / apiCap;
    const served = Math.min(admitted, apiCap);

    // DB: connection pool, contention, and the thrash you get when pods ask for more connections than the DB has
    const thrash = 1 + Math.max(0, s.replicas * s.pool - s.dbMax) / s.dbMax;
    const connLimit = Math.max(1, Math.min(s.dbMax, ready * s.pool));
    // GC-paused pods hold their connections longer, so the DB looks slow too (a classic red herring).
    let q = sys.db.query_ms * (s.faults.slow_query?.factor || 1) * thrash * (1 + gcFrac);
    const dbQps = served * (1 - s.hit) * sys.db.queries_per_miss;
    const dbSat = (dbQps * q) / 1000 / connLimit;
    q *= 1 + Math.max(0, Math.min(dbSat, 1.5) - 0.7) * 2;
    const conns = Math.min(connLimit, (dbQps * q) / 1000);

    // Outcome
    const bottleneck = Math.max(apiSat, dbSat);
    let err = bottleneck > 1 ? 1 - 1 / bottleneck : 0;
    err = 1 - (1 - err) * (1 - (s.faults.bad_deploy?.error_pct || 0) / 100);
    err = Math.min(1, err + 0.0008 * Math.abs(gauss()));
    const failed = shed + admitted * err;
    const errPct = (failed / offered) * 100;
    s.errPrev = err;
    s.req += offered; s.err += failed;

    const gcPause = gcFrac * 400;
    const svc = sys.api.base_latency_ms + (1 - s.hit) * sys.db.queries_per_miss * q;
    const queue = 1 / (1 - Math.min(bottleneck, 0.97));
    const p50 = svc * Math.sqrt(queue) + gcPause * 0.2;
    let p99 = svc * queue * 2.5 + gcPause;
    if (bottleneck > 1) p99 += (bottleneck - 1) * sys.api.timeout_ms;
    p99 = Math.min(sys.api.timeout_ms, p99);
    const cpu = Math.min(100, Math.min(perPodLoad, 1) * 90 + gcFrac * 100);

    const n = () => 1 + 0.02 * gauss();
    const nr = n();
    s.samples.push({
      t, rps: offered * nr, rps_ok: (offered - failed) * nr, error_pct: errPct, p50_ms: p50 * n(), p99_ms: p99 * n(),
      api_cpu_pct: Math.min(100, cpu * n()), api_ready: ready, db_conns: conns * n(), db_conn_limit: connLimit, db_query_ms: q * n(),
      heap_pct: Math.min(100, s.heap), gc_pause_ms: gcPause * n(), cache_hit_pct: s.hit * 100,
    });

    // Incident bookkeeping uses the truth; alerts only see lagged data, like a real scrape pipeline.
    if (errPct > 1 && s.incidentStart == null) s.incidentStart = t;
    if (s.incidentStart != null) {
      if (errPct < 1) { s.okSince ??= t; if (s.mitigatedAt == null && t - s.okSince >= 60) s.mitigatedAt = s.okSince; }
      else { s.okSince = null; s.mitigatedAt = null; }
    }
    evalAlerts();
    if (t >= pb.duration_s) { s.done = true; log('system', 'drill over: see the debrief'); }
  }

  function visible() { return s.samples.filter((x) => x.t <= s.t - lag); }

  function evalAlerts() {
    const latest = s.samples[s.samples.length - 1 - lag];
    if (!latest) return;
    for (const al of pb.alerts || []) {
      const st = (s.alerts[al.id] ??= { state: 'ok', since: null });
      const hit = al.op === '>' ? latest[al.metric] > al.value : latest[al.metric] < al.value;
      if (hit) {
        st.since ??= s.t;
        if (st.state !== 'firing' && s.t - st.since >= (al.for_s ?? 0)) {
          st.state = 'firing';
          s.firstAlertAt ??= s.t;
          log('alert', `FIRING ${al.summary}`, { severity: al.severity || 'warning', alert: al.id });
        }
      } else if (st.state === 'firing') {
        st.state = 'ok'; st.since = null;
        log('resolved', `RESOLVED ${al.summary}`, { alert: al.id });
      } else st.since = null;
    }
  }

  function act(action, params = {}, note = '') {
    if (s.done) return { ok: false, error: 'The drill is over. Read the debrief or start again.' };
    if (!pb.actions.includes(action)) return { ok: false, error: `"${action}" is not available in this playbook. Available: ${pb.actions.join(', ')}` };
    if (s.pending.some((p) => p.action === action)) return { ok: false, error: `"${action}" is already in progress` };
    const def = ACTIONS[action];
    params = { ...pb.action_defaults?.[action], ...params };
    s.actions.push({ t: s.t, action, params, note });
    log('action', def.label + (note ? ` (${note})` : ''), { action });
    s.pending.push({ at: s.t + def.delay_s, action, params });
    if (def.delay_s === 0) applyDue();
    return { ok: true, action, takes_effect_in_s: def.delay_s };
  }

  function applyDue() {
    s.pending = s.pending.filter((p) => {
      if (p.at > s.t) return true;
      log('effect', `${ACTIONS[p.action].label}: ${ACTIONS[p.action].run(s, sys, p.params || {})}`, { annotate: !ACTIONS[p.action].comms });
      return false;
    });
  }

  function firingAlerts() {
    return (pb.alerts || []).filter((a) => s.alerts[a.id]?.state === 'firing').map((a) => ({ id: a.id, severity: a.severity || 'warning', summary: a.summary }));
  }

  function debrief() {
    const firstFix = s.actions.find((a) => !ACTIONS[a.action].comms && s.incidentStart != null && a.t >= s.incidentStart);
    const took = (id) => s.actions.find((a) => a.action === id);
    const availability = s.req ? 1 - s.err / s.req : 1;
    return {
      finished: s.done,
      sim_time_s: s.t,
      availability_pct: +(availability * 100).toFixed(2),
      slo_pct: slo * 100,
      error_budget_left_pct: Math.round((1 - (1 - availability) / (1 - slo)) * 100),
      incident_started_at_s: s.incidentStart,
      first_alert_at_s: s.firstAlertAt,
      first_mitigation_at_s: firstFix?.t ?? null,
      mitigated_at_s: s.mitigatedAt,
      time_to_mitigate_s: s.mitigatedAt != null && s.incidentStart != null ? s.mitigatedAt - s.incidentStart : null,
      your_actions: s.actions.map((a) => ({ at_s: a.t, action: a.action, note: a.note })),
      expert_path: (pb.debrief?.expert_path || []).map((e) => ({ ...e, you_at_s: took(e.action)?.t ?? null })),
      pitfalls_hit: (pb.debrief?.pitfalls || []).filter((p) => took(p.action)),
      lessons: pb.debrief?.lessons || [],
      senior_note: pb.debrief?.senior_note || null,
    };
  }

  return { pb, sys, state: s, step, act, visible, firingAlerts, debrief, lag };
}
