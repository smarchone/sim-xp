---
name: story-to-playbook
description: Turn a story (blog post, postmortem, concept or short prompt) into a validated sim-xp playbook file that the sim-xp player animates as a narrated, realistic simulation.
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

Your output is one file, a validated playbook. The person plays it themselves: they open the player at
https://smarchone.github.io/sim-xp/v2/ and drop the file on it.

Everything you need is next to this file (`<skill>` below means this skill's folder):

| File | What it is |
|---|---|
| `<skill>/examples/kafka-rebalance-storm.json` | The approved example. Read it before writing your own. |
| `<skill>/scripts/validate.mjs` | `node <skill>/scripts/validate.mjs <file> [--at 60,120]`: checks the playbook and prints the world (metric values, alert fire and resolve times) at every key moment. Node 18+, no dependencies. |

Write the playbook to `playbooks/<id>.json` in the current folder, where `<id>` is `meta.id`, unless the person
names another place.

## Workflow

0. **Read the example**, `<skill>/examples/kafka-rebalance-storm.json`, end to end.
1. **Read the story** (fetch it if it is a URL). Pull out: the system, the trigger, the mechanism (why it got worse),
   what people saw and did, the fix, and the lesson. If the story is vague, invent realistic
   detail (names, versions, numbers, config keys, log lines) consistent with how the real tech
   behaves. Real defaults beat round numbers (`max.poll.interval.ms=300000`, not "a timeout").
2. **Plan the arc** in 4–7 key moments: meet the system (t≈3s, all calm) → trigger → it gets
   worse (the mechanism) → someone acts / the fix → why the fix works → recovered. One idea per
   key moment.
3. **Write the playbook** (schema below). Start from the example's shape.
4. **Observe the world.** Run the validator on the file. Read the values at each key moment and the
   alert times, and check they tell your story: does lag actually rise before the alert? does the
   note's claim match the number? Use `--at` for any other second. Fix and re-run until there are no
   errors, and every warning is either fixed or one you can justify.
5. **Hand it over** in a few lines: the file path, the arc in one line per key moment, any warnings you
   kept and why, and how to play it: open https://smarchone.github.io/sim-xp/v2/ and drop the file on the
   page (or use "Open a playbook file…"). In the player, Space plays and pauses, ←/→ jump between key
   moments, and R opens the report.

## Schema `sim-xp/playbook@2`

Top level: `schema`, `meta`, `components`, `metrics`, `dashboard`, `alerts`, `initial`,
`timeline`, `report`. Times are integer seconds from 0 to `meta.duration_s`.

### meta
`{ id, title, story, duration_s, tags[], background[], cast[], watch[], learn[] }`
- `title`: short and evocative ("The rebalance storm: when slow looks dead").
- `story`: the hook, 1–2 sentences, shown large at the top of the intro and as the subtitle in the gallery. Sets the scene, does not spoil the cause.
- `duration_s`: 240–600 is typical (the viewer watches at 1×–4×).
- `clock` (optional) `{ start?, scale?, changes? }`: real story time. By default one playbook second is one story second. For a long story set `scale` = story seconds per playbook second (a 2-month story in 420 s: 12,500; one hour per second: 3,600) and the clock, feed times, chart axes and key moments show story time ("Day 23", "Oct 21 22:52"), so nothing is shown as "8 seconds". `start` is an ISO date ("2018-10-21T22:51:18Z", shown in UTC) if the real dates matter, otherwise the clock counts "Day N". `changes` `[{ t, scale }]` switches the scale at playbook second `t` (real time through the trigger, then fast-forward through a long recovery). Keep event times (`t`) in playbook seconds and make sure feed text, durations and curves agree with the clock.
- `layout` (optional) `{ columns: 1|2|3, rows: 1–8 }`: how the charts are arranged. The components (left) and feed (right) are fixed; the viewer can only widen the components by dragging the vertical divider (3 to 6 of 12 columns), which is not a playbook setting. `columns` is the number of chart columns between them (default 2); `rows` is how many chart rows fit on one screen before the board scrolls (default: fit all charts, between 2 and 5). Use 2 columns × 4–5 rows for ~8–10 charts; 3 columns for many small charts; 1 column × 3 rows for a few tall ones.
- The rest is the **intro**: it is how a viewer who has never seen this system gets the context. Write for an engineer who knows software but not this stack.
  - `background`: 2–4 `{ title, body }` paragraphs, each ≤ ~400 chars, plain words. A good set is "The system" (what it is, rough scale, why it is built this way), "How it normally works" (the mechanism, in the normal state), "Today" (what is about to happen). Do not spoil the cause.
  - `cast`: `[{ name, role }]`, one per component the viewer will see (use the component labels), role in a few words.
  - `watch`: `[{ label, normal }]`, 2–3 things to keep an eye on with the normal value (`{ "label": "Replica replay lag", "normal": "normal < 1 s" }`).
  - `learn`: 2–4 short "you'll come away knowing…" lines. No spoilers; name the question, not the answer.

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
- 8–12 metrics: the ones the story is about plus the supporting signals an engineer would open next (CPU, latency, queue depth, connections, error counts, user-visible symptoms such as support tickets). Each must move for a reason in the story, or hold steady on purpose. `noise` is relative jitter (0.02–0.1; 0 for counters).
- Pick the signals an engineer would really watch for this system.

### dashboard
`[{ id, title, why, metrics: [metricId...], threshold?: { value, label } }]`
- `why` (one sentence, ≤ ~140 chars): why this metric matters in this story. Shown behind an ⓘ on the panel. Say what a rise or fall means, or what wrong conclusion it rules out. Every panel gets one.
- 6–10 panels (the board scrolls past ~10). Put two metrics on one panel when comparing them is the point (produced vs consumed),
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
- **feed** `{ from, kind, text, key? }`, kind one of `chat`, `log`, `deploy`, `alert`, `resolved`. Entries on a key moment and alert entries are softly highlighted automatically; set `key: true` on any other line the viewer must not miss (the message that explains the cause, the decision, the fix).
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
`{ tldr, fix_t?, chain[], loop?, stats[], learnings[], math?, myths?, links? }`
The report is a calm single column: tl;dr, the numbers, how it happened, (the arithmetic), takeaways, (myths), (read more).
- `tldr`: one or two sentences, cause → consequence.
- `chain`: 4–6 steps `{ id, kind, text }`, shown as a list, one sentence each (≤ ~100 chars), kind `cause` | `effect` | `amp` (amplifier) | `fix`.
- `loop` `{ from, to, label }`: a feedback loop between two chain steps, when there is one.
- `stats` `[{ label, metric, unit, agg: "max"|"min"|"delta" }]`: 2–4 numbers worth remembering,
  shown as worst (max or min over the run) and the value at the end; `delta` shows change before vs after `fix_t`. `fix_t` marks the fix.
- `learnings` 3–4 `{ glyph, title, body }`: title ≤ 40 chars, body one or two sentences, actionable. (`glyph` is kept for old playbooks and not drawn.)
- `math` (optional) `{ title?, lines[] }`: the back-of-envelope that explains the mechanism, one line per step, monospace (`"42M rows ÷ 50k per batch = 840 batches"`).
- `myths` (optional) `[{ myth, truth }]`: the tempting wrong explanations ("Add a third replica"), and why they fail. 1–3.
- `links` (optional) `[{ label, url }]`: 1–3 https links to read more (docs, the original postmortem). Only link what you are sure exists.
- `sparkline` is no longer drawn; leave it out.

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
it by dropping it on the page. To bundle it with the page, add it to `v2/playbooks/` in sim-xp and list it in
`v2/playbooks/index.json` (id, file, title, story, duration_s, tags, key_moments).
