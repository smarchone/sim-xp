# Writing a playbook

A playbook is one JSON file that encodes an experience: what the world looked like, what went wrong and
when, what the learner can do, and what you actually did. Start from
[`playbooks/flash-sale-pool-exhaustion.json`](playbooks/flash-sale-pool-exhaustion.json).

| Field | Required | What it is |
|---|---|---|
| `id` | yes | lowercase-and-dashes |
| `title` | yes | |
| `author` | | `{ "name", "note" }` |
| `rung` | | who it's for, e.g. "junior to senior" |
| `tags` | | |
| `duration_s` | yes | 60..3600 simulated seconds |
| `seed` | | default seed; same seed + same actions = same run |
| `scrape_lag_s` | | how far the dashboard lags (default 15) |
| `slo` | | `{ "availability": 0.98 }` for the error-budget tile |
| `story` | yes | the briefing: what the learner knows going in. Don't give the answer away. |
| `system` | | overrides of the default system (see below) |
| `timeline` | yes | events by time: `fault`, `clear`, `message`, `deploy` |
| `alerts` | | `{ id, metric, op: ">" or "<", value, for_s, severity, summary }` |
| `actions` | yes | action ids the learner gets |
| `action_defaults` | | default params per action, e.g. `{ "rate_limit": { "rps": 1750 } }` |
| `runbook` | | `[{ title, detail }]`: your advice, hidden until the learner opens it |
| `debrief` | | `expert_path` (what you did and why), `pitfalls` (tempting moves that make it worse), `lessons`, `senior_note` |

## Timeline events

```json
{ "at": 170, "fault": "traffic_spike", "params": { "multiplier": 2.5, "ramp_s": 60 } }
{ "at": 400, "clear": "traffic_spike" }
{ "at": 150, "deploy": "orders-api v2.14.0 rolled out by ci-bot" }
{ "at": 360, "message": "What's the ETA?", "from": "VP Eng", "unless_action": "post_update" }
```

`deploy` events draw a marker on every graph. `unless_action` skips the event if the learner already did that.

## Faults

| Fault | Params | Effect |
|---|---|---|
| `traffic_spike` | `multiplier`, `ramp_s` | traffic ramps to base x multiplier |
| `cache_degrade` | `hit_ratio` | more requests go to the DB |
| `slow_query` | `factor` | every query takes longer |
| `memory_leak` | `mb_per_s` | heap climbs with load; GC pauses, then OOM kills |
| `bad_deploy` | `error_pct` | a share of requests fail |

## Actions

`declare_incident`, `post_update` (communication, scored in the debrief only), `rate_limit` (`rps`),
`remove_rate_limit`, `scale_api` (`by`), `right_size_pool`, `disable_retries`, `warm_cache`, `restart_api`,
`rollback`, `add_index`. Each lands after a delay (`get_playbook_format` lists them).

## Default system

```json
{
  "traffic": { "base_rps": 800, "noise": 0.03 },
  "api": { "replicas": 4, "rps_per_replica": 300, "pool_size": 20, "base_latency_ms": 40, "timeout_ms": 3000,
           "heap_start_pct": 55, "heap_mb": 1024, "retry_attempts": 2 },
  "cache": { "hit_ratio": 0.9 },
  "db": { "max_connections": 100, "query_ms": 20, "queries_per_miss": 5 }
}
```

## Tips

- Faults change the system, not the graphs. If the dynamics you remember don't show up, change the system
  numbers until they do.
- Add a red herring. Every real incident has one.
- Put the move you got wrong in `pitfalls`, with what it taught you. That's the part nobody else can write.
- Check it: load it in the page (or `install_playbook`) and play it once, then add a test like the ones in
  `test/engine.test.mjs`.
