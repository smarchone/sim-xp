---
description: Turn a story (blog post, postmortem, concept or short prompt) into a sim-xp playbook and play it in the browser through WebMCP
argument-hint: "[story, URL or prompt]"
---

# Story → playbook

sim-xp plays a **playbook**: a scripted, deterministic run of a small system. The viewer
watches components light up, dashboards move, a feed scroll, and pauses on a few **key moments**
that explain what just happened. At the end, a one-screen **report** sums it up.

The bet: seeing a system in motion is easier than reading about it. Your job is to make the run
**realistic, relevant and easy to follow**. Concepts (replication lag, Kafka rebalancing) and
incidents are the same thing here: every playbook is a narrated story.

Story: $ARGUMENTS

The player is a web page, https://smarchone.github.io/sim-xp/v2/ (source: https://github.com/smarchone/sim-xp/tree/main/v2).
You reach it through the `webmcp` MCP server (the [WebMCP bridge](https://github.com/smarchone/webmcp-apps)).
If that server is not set up, stop and give the person the command:
`claude mcp add webmcp -- npx -y @smarchone/webmcp-bridge`.

The page's tools, called with the bridge's `page_call_tool`:

| Tool | Use it to |
|---|---|
| `list_playbooks`, `load_playbook {id}`, `get_playbook` | Read the bundled playbooks. `kafka-rebalance-storm` is the approved example: read it before writing your own. |
| `validate_playbook` | Check a playbook and see the world (metric values, alert fire/resolve times) at every key moment |
| `load_playbook` | Load your playbook into the player and show its story |
| `get_state`, `wait_for`, `control` | Look at the world at any second, wait for a key moment, drive playback when asked |

Pass playbooks as files: write `playbooks/<id>.json` (`<id>` is `meta.id`) in the folder Claude Code runs in,
and pass `{"$file": "playbooks/<id>.json"}`. The bridge inlines the file, so the JSON stays out of the conversation.
Inside a sim-xp clone, write to `v2/playbooks/` instead; there `node v2/tools/validate.mjs <file> [--at 60,120]` runs
the same checks offline.

## Workflow

0. **Open the page.** `browser_open_page` with `https://smarchone.github.io/sim-xp/v2/` (or a local
   `http://localhost:3000/` when testing player changes), then `load_playbook {"id": "kafka-rebalance-storm"}`
   and `get_playbook` to read the example.
1. **Read the story** (fetch it if it is a URL). Pull out: the system, the trigger, the mechanism (why it got worse),
   what people saw and did, the fix, and the lesson. If the story is vague, invent realistic
   detail (names, versions, numbers, config keys, log lines) consistent with how the real tech
   behaves. Real defaults beat round numbers (`max.poll.interval.ms=300000`, not "a timeout").
2. **Plan the arc** in 4–7 key moments: meet the system (t≈3s, all calm) → trigger → it gets
   worse (the mechanism) → someone acts / the fix → why the fix works → recovered. One idea per
   key moment.
3. **Write the playbook** (schema below). Start from the example's shape.
4. **Observe the world.** Call `validate_playbook` with the file. Read the values at each key moment and the
   alert times, and check they tell your story: does lag actually rise before the alert? does the
   note's claim match the number? Pass `at: [seconds]` for any other moment. Fix and re-run until clean.
5. **Load and play it:**
   - `load_playbook` with `{"playbook": {"$file": "playbooks/<id>.json"}}`. The bridge
     inlines the file, so the JSON stays out of the conversation. Add `"autoplay": true` only when the person
     asked you to start it; otherwise the story shows and they press Space.
   - Tell the person how to watch: Space plays and pauses, ←/→ jump between key moments, R opens the report.
   - To check the run yourself, `get_state` with `t` shows the world at any second without moving playback.
   - Finish with one or two lines: what is playing, and the file path for replaying it later.

## Schema `sim-xp/playbook@2`

Top level: `schema`, `meta`, `components`, `metrics`, `dashboard`, `alerts`, `initial`,
`timeline`, `report`. Times are integer seconds from 0 to `meta.duration_s`.

### meta
`{ id, title, story, duration_s, tags[] }`
- `title`: short and evocative ("The rebalance storm: when slow looks dead").
- `story`: 2–3 sentences shown first. Sets the scene, does not spoil the cause.
- `duration_s`: 240–600 is typical (the viewer watches at 1×–4×).

### components
`{ nodes: [{ id, label, kind, parts?: [{id}], part_cols? }], edges: [{ id, from, to }] }`
- 4–10 nodes; only what the story needs. Labels are real-looking names (`payments-db`, `orders topic`).
- `kind` is free text shown under the label (`postgres`, `kafka-topic`, `redis`, `lb`).
- `parts` are sub-cells you can colour on their own (partitions, shards, replicas, pods).
- Edges point in the direction of the request/data flow. The app lays out the graph itself
  (left→right or top→bottom, whichever fits the screen): do not add positions.
- Nodes appear at the start and stay. To show scaling out or a failover target, declare the
  spare nodes/parts up front, start them `grey` with `label: "idle"` (or `down: true`), and bring them up later.

### metrics
`[{ id, label, unit, start, noise, normal?: [lo, hi] }]`
- 4–8 metrics. `noise` is relative jitter (0.02–0.1; 0 for counters).
- Pick the signals an engineer would really watch for this system.

### dashboard
`[{ id, title, metrics: [metricId...], threshold?: { value, label } }]`
- 3–6 panels. Put two metrics on one panel when comparing them is the point (produced vs consumed),
  and only when they have the same unit and similar size: the panel has one y-axis.
- A threshold line on a panel makes "crossed the limit" visible.
- Optional `max` fixes the y-axis top (otherwise: just above the peak; `%` panels stop at 100).

### alerts
`[{ id, metric, op: ">"|"<", value, for_s, severity: "critical"|"warning", component, summary }]`
- Alerts fire **from the curves** (value past threshold for `for_s` seconds) and light the component.
  Do not script alert firing; shape the curve so it fires when the story needs it, and check the time in the validator output.
  The player writes the FIRING and RESOLVED lines into the feed itself. Use feed kinds `alert`/`resolved`
  only for messages that are not one of these alerts (a status-page update, a pager from another team).

### initial
`{ effects: [Effect] }`: the calm starting look (e.g. partition colours by owner, edge flow).

### timeline
Sorted list of events: `{ t, title?, feed?, effects?, metrics?, beat? }`
- **feed** `{ from, kind, text }`, kind one of `chat`, `log`, `deploy`, `alert`, `resolved`.
  Write real-looking log lines and Slack-style chat ("db looks a bit slower since the migration, but nothing is failing").
  Deploys also show as markers on every chart. 8–20 feed entries make a run feel alive.
- **metrics** `[{ id, to, over_s, shape }]`: a keyframe. The metric moves from its current value to
  `to` over `over_s` seconds. `shape`: `ease` (default, natural), `linear` (steady growth such as lag
  accumulating), `step` (instant: counters, config changes).
  Backlogs must add up: lag grows at (in − out) per second, so with in=1200 and out=900 it is
  `linear` to +300×over_s. Do the arithmetic, then confirm with `--at`.
- **effects** `[Effect]`: change how components look (below).
- **title**: a short label; events with a title become chapter names.
- **beat** `{ hint, focus[], notes[] }` makes this a **key moment**: playback pauses, and
  - `hint` (≤ 340 chars, 2–3 plain sentences) rises under the components view and explains *why*;
  - `focus` lists what to highlight: node ids, edge ids, `"panel:<id>"`, `"feed"`;
  - `notes` `[{ panel, metric?, text }]` put a short tooltip (≤ 80 chars) on each chart that moved,
    saying why it moved ("p99 past budget: replay and catch-up pile onto a slow DB").
  Every key moment needs a `title`.

### Effect
`{ target, ...knobs }`. Knobs merge over time; set a knob to `null` to clear it.
- Node or part (`"topic/p2"`): `color`, `intensity` (0–1), `pulse` (bool), `label` (short status
  under the node, e.g. "batch: 5m 20s of 5m limit"; ≤ 30 chars on a node, ≤ 10 on a part),
  `badge` (tiny tag, e.g. "p0 p1"), `down` (bool, crossed out).
- Labels with numbers ("lag 13s") do not follow the metric; update them when the number has moved, or prefer words ("lagging").
- Edge: `color`, `flow` (0–1, animated traffic), `reverse` (0–1), `width` (0–1).
- Colours: `red`, `amber`, `green`, `blue`, `teal`, `violet`, `pink`, `grey`, or `#rrggbb`.
- Be creative but consistent: red = failing/overloaded, amber = degrading, blue = cold/idle,
  grey = paused, distinct colours = ownership. Changing traffic should change edge `flow`.

### report
`{ tldr, fix_t?, sparkline?, chain[], loop?, stats[], learnings[] }`
- `tldr`: one or two sentences, cause → consequence.
- `chain`: 4–6 boxes `{ id, kind, text }` (text ≤ 42 chars, wraps to 3 short lines), kind `cause` | `effect` | `amp` (amplifier) | `fix`.
- `loop` `{ from, to, label }`: a feedback loop between two chain boxes, when there is one.
- `stats` `[{ label, metric, unit, agg: "max"|"min"|"delta" }]`: 2–4 numbers worth remembering,
  shown as worst (max or min over the run) → value at the end; `delta` shows change before vs after `fix_t`.
- `sparkline`: the metric that best shows the whole run (defaults to the first panel's first metric); `fix_t` marks the fix.
- `learnings` 3–4 `{ glyph, title, body }`: title ≤ 40 chars, body one sentence, actionable.

## Rules of thumb

- **Realistic first.** Numbers should hold together: if consumption drops below production, lag
  must grow at the difference; a fix needs time to drain. Use the validator to check.
- **Every key moment shows a visible change** in at least one chart and in the components view.
  The validator warns when a note sits on a chart that barely moves; that warning is fine when
  the note is about a value holding steady (a plateau, a ceiling) or on the last "recovered" moment.
- **Something happens every 10–30 seconds**: a feed line, an effect, or a curve visibly moving; no dead stretches.
- **Compressing time** (a 24-hour incident in 8 minutes): say so in `meta.story` ("compressed: 1 s ≈ 3 min"),
  and put real clock times in feed text where they matter ("22:52 UTC"). The player's clock shows run time.
- **Real postmortems:** keep the public facts (timeline, numbers, decisions) accurate; invented colour
  (chat lines, host names) is fine. Add the tag `dramatized` when you invent detail.
- Keep `noise` ≤ 0.1 on metrics shown as stats; noise makes peaks look higher than the curve you wrote.
- **Show, then explain.** Let the chart move a few seconds before the key moment that explains it.
- Include the wrong turn people take when it is realistic ("should I scale out?"), and say in the hint or learnings why it would not help.
- Keep text short; the viewer is watching, not reading.
- Free-form fields are fine where the schema says free text. Do not add new top-level keys.

## Freezing a good run

A playbook plays the same every time, so a good one is already frozen: keep the file, and anyone can replay
it by dropping it on the page or loading it with `load_playbook`. To bundle it with the page, add it to
`v2/playbooks/` in sim-xp and list it in `v2/playbooks/index.json` (id, file, title, story, duration_s, tags,
key_moments). `get_playbook` returns the loaded JSON if it was
edited elsewhere.
