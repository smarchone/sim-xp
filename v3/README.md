# sim-xp v3

v3 is v2 with less on screen, so the student builds the mental model from the graphs and the feed. It is one page you scroll, in three sections, with no popups:

1. **Brief** (reading). The story, the background and the 2 to 3 signals to keep an eye on (`meta.watch`, with their normal range) on the left; the system diagram on the right. Nothing plays until **Run the simulation**.
2. **Run** (one screen). The dashboard on the left: a gauge per watched signal (live value coloured by its alert, normal range, trend), then every chart in a fixed grid, each with its unit. Charts never move or appear mid-run; a key moment pauses and highlights the charts that matter. The key moment is a banner under the charts, just above the scrubber (the player has no title bar): tinted in its tone with a thick tone edge, a larger title and the full explanation, and slides in with a glow, while the notes sit on the highlighted charts. It keeps one height, so the board never moves. Space plays and pauses only while this section is on screen. It plays like a video: a play poster before the first play, a centre flash on play and pause, and a control bar under the board with a red scrubber split into chapters (one per key moment; hover shows the chapter, the video time and the story clock; drag to seek anywhere), play/pause/replay, next key moment, the time at 1× (`0:54 / 2:00`) with the current chapter, speed, and full screen where the page allows it. The bar fades while playing and the mouse is still. The player's ⚙ holds playback settings only (speed, Standard/Hardcore detail) and, with the keyboard help, sits at the right end of the bar and opens upward. Page settings (More playbooks, theme) are in the sim-xp header at the top of the page. The event feed is off by default, so a first run is the gauges and charts only: **Events** in the bar (or E) shows it as a live-events chat beside the player, outside its frame, and is remembered (the player keeps its width either way); while it is hidden, a red dot on the button says an alert has landed. The player is a centred frame a little under the screen height. Keys: Space or K, J/L (back/forward 10 s), ←/→ (key moments), E (events), F.
3. **Result** (reading). Locked until the run has ended once, so scrolling down cannot give it away. Then: the summary, the numbers and three takeaways; the causal chain, arithmetic, myths and links are behind **How it happened, and more**.

It also looks like a monitoring dashboard: dark first (Light and Auto are in the menu), flat panels, Inter and Roboto Mono, time series with a soft area fill, a grid, a clock-time axis, a legend with the live value, and thresholds as a dashed line over a tinted band.

Playbooks are the same format as v2 (one validator, `js/playbook.js`, shared with the skill). `meta.watch[]` entries may name their chart with `panel` (a `dashboard` id); without it the player matches the chart by title or series label.

`node v3/build-single.mjs` writes `v3/dist/sim-xp.html`; Pages serves it at https://smarchone.github.io/sim-xp/v3/.

## The app is one file

`node v3/build-single.mjs` writes `v3/dist/sim-xp.html`: the player, a collapsible side panel, and the bundled
two bundled playbooks (the default and the format example), with no other files. Every other playbook is loaded from a GitHub repo when you ask for it. That one file is both:

- **the GitHub Pages site**, at https://smarchone.github.io/sim-xp/v3/ (the site root is the docs page), and
- **a Claude artifact**, where the panel's chat can ask Claude (on the viewer's own Claude usage) to write a playbook.

The side panel (right, resizable) starts folded to a thin **Playbooks** rail, so a first visit is just the simulation. Opened, it has, top to bottom:

| Part | What it does |
|---|---|
| Library | Playbooks listed from GitHub repos ([smarchone/simxp-playbooks](https://github.com/smarchone/simxp-playbooks) by default; add any other with `owner/repo`). Open by default. Each repo is a collapsible group (one open at a time, ↻ refetches its list, ✕ removes it). Click a playbook to play it; the panel folds away. The list (`index.json`) is fetched fresh when the panel first opens on a visit; each playbook you open is cached for a week, apart from Saved; the list of repos you added is kept too. |
| Saved | Up to 20 playbooks you made (written by Claude, pasted, or opened from a file) kept in this browser's storage. Click to play, ⤓ to export, ✕ to delete. |
| Make your own | In the Claude artifact, a chat that asks Claude for a playbook or a change to the current one. Elsewhere, a one-line pointer to the `story-to-playbook` skill instead. |
| Playbook box | A row with the validator's result, **Open file…**, **Save .json** and **Run**; the JSON (what Run plays, the current playbook) is hidden until **Edit JSON**. Problems are listed even while it is hidden, and opening a file with problems shows it. Dropping a file on the page loads it too. |

In the player, Space plays and pauses, ←/→ jump between key moments, R opens the report, H switches Hardcore detail.

## Playbook repos (the Library)

A playbook repo is a folder of playbook `.json` files and an `index.json` next to them. The panel fetches
`https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<folder>/index.json` when the Library opens, and a playbook only when it is clicked.
Add a repo as `owner/repo` (default branch, root folder), `owner/repo@branch/folder`, or paste its github.com link.

`index.json` is a list; each entry is one playbook. It is generated: in simxp-playbooks, `node build-index.mjs` writes it from the playbook files and CI checks it is current.

```json
[
  {
    "id": "postgres-queue-load-test",
    "file": "postgres-queue-load-test.json",
    "title": "Postgres as a queue: the load test that found the wall",
    "story": "One or two sentences shown as the hover text.",
    "duration_s": 330,
    "tags": ["postgres", "queue"],
    "key_moments": 6
  }
]
```

`id` (must equal the playbook's `meta.id`), `file` (a path inside the folder, ending in `.json`) and `title` are required; the rest is shown in the list when present. A playbook is validated before it is loaded, so a bad file shows a message instead of running. `{"playbooks": [...]}` is accepted too.

The address picks the playbook. A repo playbook's link always names its repo, the default repo too: `#smarchone/simxp-playbooks:<id>` or `#<owner/repo[@ref][/folder]>:<id>`, so it works for someone who has not added the repo and two repos can share an id. A plain `#<id>` is a playbook in your Saved list (older links also fall back to the bundled two and the repos). Editing a repo playbook and running it saves a copy under a new id (`<id>-copy`). With no id the last playbook played opens.

## Develop

```sh
node v3/build-single.mjs         # build v3/dist/sim-xp.html (git-ignored)
open v3/dist/sim-xp.html         # runs from disk too, minus the Claude chat
node --test v3/test/*.test.mjs   # validator, bundled playbooks, and the build
```

## Update the artifact

The artifact is published from a Claude session; CI cannot do it. After changing the code:

1. `node v3/build-single.mjs`
2. In a Claude session on this repo, ask it to publish `v3/dist/sim-xp.html` to the existing artifact URL with capabilities
   `{sample: {}, downloads: true}`. The URL stays the same and open pages update.

Pages deploys itself on every push to `main` (`.github/workflows/pages.yml`).

## What's in it

| Path | What it is |
|---|---|
| `build-single.mjs` | The build: stitches everything below into one file |
| `player.html` | The player. It plays the playbook its host page hands it, and exposes `window.player` for playback |
| `sidebar/` | The side panel: `page.html`, `page.css`, `page.js` (chat, playbook box, Saved list, drop and export) |
| `js/playbook.js` | Symlink to the skill's validator (`../.claude/skills/story-to-playbook/scripts/playbook.js`), shared by the panel, the skill and the tests |
| `js/tools.js` | WebMCP tools that let an agent drive a page that exposes them. Kept for reference, not part of the build |
| `playbooks/` | The playbooks the build bundles, and a copy of the library's `index.json` (the build bundles only the default and the format example; the full library now lives in simxp-playbooks); the Kafka rebalance one is a symlink to the skill's example |
| `test/` | Tests: validator, bundled playbooks, the build |
| `../.claude/skills/story-to-playbook/` | The skill: format, authoring rules, one example, and the validator (`node scripts/validate.mjs pb.json [--at 60,120]`) |

## Adding a bundled playbook

Write it with the `story-to-playbook` skill (it validates), put the file in `playbooks/`, and add an entry to
`playbooks/index.json` (id, file, title, story, duration_s, tags, key_moments). The build bundles every entry, and a
new visitor finds it in the Saved list. `build-single.mjs` names which two playbooks are the box's default and
Claude's format example.

## With Claude Code

The skill is self-contained: the format and authoring rules, an example playbook, and the validator. Install it
and give it a story, then open the playbook file in the page's panel (or drop it on the page):

```sh
npx skills add smarchone/sim-xp --skill story-to-playbook -g
claude "/story-to-playbook why Postgres replicas fall behind during a big backfill"
```
