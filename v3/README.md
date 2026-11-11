# sim-xp v3

v3 is v2 with less on screen, so the student builds the mental model from the graphs and the feed. A playbook opens in one of two modes, switched with **▶ Watch | Read** in the sim-xp header:

- **Watch** (the default): the whole post is one narrated video in the player's frame, on one scrubber. The scenes, in order: a title slide (the story), one slide per background block, the system map, *What to watch* (the real dashboard with the watched charts highlighted), the run, then the result deck, one slide per scrubber chapter. The narrator is on from the start (Voice turns it off, and Watch remembers that). With **Events** on, the live-events column beside it is exactly as tall as the video, its top and bottom edges level with the frame's. While it plays, nothing waits for a click. A slide moves on when the narrator has read it (Voice on), or after its reading time (about 155 words a minute, 4 to 28 s) when the voice is off, so each slide serves as its own caption. Key moments do the same: the banner stays up while it is read, then the run carries on. Playback speed applies to the run only; slides keep the narrator's pace. Space plays and pauses the video; ⏭, ← and → move between chapters (← first goes back to the start of the current one); J and L skip 10 s; dragging the scrubber seeks anywhere, across scenes. At the end, an end card offers **↺ Watch again** and **Read it as a post**. The slides' spoken text is written in `player.html` (each result slide's `v` lines), so the playbook format is unchanged.
- **Read**: the blog, described below.

The choice is remembered. `?mode=watch` or `?mode=read` on the page's address picks it for one link. Switching keeps your place: a result slide maps to the result deck at that slide, the run to the player at the same second, and the opening slides to the brief. `window.player.mode("watch" | "read")` switches too, and `status()` reports the mode (and, in Watch, the scene and the video time).

Read is one page you scroll, in three sections, with no popups:

1. **Brief** (reading). The story, the background and the 2 to 3 signals to keep an eye on (`meta.watch`, with their normal range) on the left; the system diagram on the right. Nothing plays until **Run the simulation**.
   Below it, **What the dashboard shows**: one compact table (component, chart, what it tells you; hover a component for what it is) covering every chart (the dashboard entry's `why`); the watched ones carry their number.
2. **Run** (one screen). The dashboard: every chart in a fixed grid (the watched ones numbered), each with its unit. A row of component chips above the player (All, loadgen, broker-1, …, with chart counts) narrows the grid to one component's charts when there are more than fit; it never changes by itself, and a key moment that points at hidden charts puts a pulsing dot on their chip. Charts never move or appear mid-run; a key moment pauses and highlights the charts that matter. The key moment is a banner just below the player, outside its frame (the frame holds only the charts and the video bar, so nothing squeezes the charts): tinted in its tone with a thick tone edge, a larger title and the explanation as bullet points (one per sentence), and slides in with a glow, while the notes sit on the highlighted charts. It is sized once per playbook to fit its longest key moment, so it never overflows and the board never moves. ⏭ (or →) past the last key moment skips to the end of the run and unlocks the result. Space plays and pauses only while this section is on screen. It plays like a video: a play poster before the first play, a centre flash on play and pause, and a control bar under the board with a red scrubber split into chapters (one per key moment; hover shows the chapter, the video time and the story clock; drag to seek anywhere), play/pause/replay, next key moment, the time at 1× (`0:54 / 2:00`) with the current chapter, speed, and full screen (⛶ or F): the player alone fills the window, with the component chips, the charts and the bar, and no page around it, no event feed and no key-moment banner (the highlighted charts and their notes still mark each key moment; Space or ▶ carries on). It goes truly full screen where the browser allows it and covers the window otherwise (the Claude artifact). Esc or ⤡ leaves it, and the feed comes back as it was. The bar fades while playing and the mouse is still. The player's ⚙ holds playback settings only (speed, Standard/Hardcore detail) and, with the keyboard help, sits at the right end of the bar and opens upward. Page settings (All playbooks, theme) are in the sim-xp header at the top of the page. In that header (on the index too), the sim-xp name goes back to the index of playbooks, and the GitHub mark beside the theme opens the project's page (https://smarchone.github.io/sim-xp/) in a new tab. The event feed is off by default, so a first run is the charts only: **Events** in the bar (or E) shows it as a live-events chat beside the player, outside its frame, and is remembered (the player keeps its width either way); while it is hidden, a red dot on the button says an alert has landed. **Voice** in the bar (or V) turns on a narrator, and is remembered for each mode on its own: Watch starts with it on (it is a narrated video), Read with it off. On the first play the run holds at 0:00 while it names the charts to watch; at each key moment it reads the number, title and explanation (and the deep note in Hardcore), then carries on by itself, like a narrated video, while at least half the player is on screen; at the end it points to the result. Pausing, seeking or Continue cuts it off, and the button pulses while it speaks. The text is rewritten for the ear first (p99 is "99th percentile", 20 MB/s is "20 megabytes per second", `max.poll.interval.ms` is "max poll interval", and so on). The narrator reads, best first: the playbook's recorded narration (made when the playbook is authored; see *Recorded narration* below), then a Google voice (Chrome's own speech, Google UK English Female first; a choice in the ⚙ is remembered) for any sentence the recording lacks. Nothing else: no speech model runs in the browser, and the other system voices are never used because they sound robotic and distract. Where there is neither a recording nor a Google voice (Safari, Firefox), Voice is not offered and the slides keep their reading time. A watchdog moves the run on if the Google voice stalls (Chrome's speech can jam). The player is a centred frame a little under the screen height. Keys: Space or K, J/L (back/forward 10 s), ←/→ (key moments), E (events), V (voice), F.
3. **Result** (reading). Locked until the run has ended once, so scrolling down cannot give it away. Then a short deck, one idea per slide: what happened, the numbers, one slide per takeaway, how it happened (the causal chain), and the arithmetic, myths, deep dive (Hardcore) and links where the playbook has them. ‹ ›, the dots, or ←/→ while the result is on screen; the slide area keeps one height so the controls never move.

It also looks like a monitoring dashboard: dark first (Light and Auto are in the menu), flat panels, Inter and Roboto Mono, time series with a soft area fill, a grid, a clock-time axis, a legend with the live value, and thresholds as a dashed line over a tinted band.

Playbooks are the same format as v2 (one validator, `js/playbook.js`, shared with the skill). `meta.watch[]` entries may name their chart with `panel` (a `dashboard` id); without it the player matches the chart by title or series label.

`node v3/build-single.mjs` writes `v3/dist/sim-xp.html`; Pages serves it at https://smarchone.github.io/sim-xp/v3/.

## The app is one file

`node v3/build-single.mjs` writes `v3/dist/sim-xp.html`: an index of playbooks, the player, and the
two bundled playbooks (the default and the format example), with no other files. Every other playbook is loaded from a GitHub repo when you ask for it. That one file is both:

- **the GitHub Pages site**, at https://smarchone.github.io/sim-xp/v3/ (the site root is the docs page), and
- **a Claude artifact**, where the index's chat can ask Claude (on the viewer's own Claude usage) to write a playbook.

The page has two views. The **index** is the start (unless the address names a playbook): a minimal, blog-like page with a one-line lede. A sidebar just left of the page's centred column (in its margin, so the column stays centred; inside the page on narrower windows) lists the **libraries**, each with its count: **sim-xp playbooks** first, then each GitHub repo you added (each with the GitHub mark beside it, linking to the repo), then **Your playground** (kept in this browser), then **+ Add a library**, which opens a small dialog: what a library is (a repo or folder of playbook `.json` files with an `index.json`), a field for its GitHub link, the other forms it takes (`owner/repo`, `owner/repo@branch/folder`, a `/tree/<branch>/<folder>` link), an example, and a link to how to make one; problems show in the dialog. The main column shows the library picked (remembered on later visits; the default repo on a first visit), its playbooks listed like posts (serif title and a quiet line of length, key moments and tags; the story shows on hover). A repo's heading has the GitHub mark (a link to the repo), ↻ and, for an added repo, remove. Your playground's heading has **+ Add your own**, which opens a drawer (✕, Esc or a click outside closes it): one line on what a playbook is, then three numbered steps: **Install the skill** (the [`story-to-playbook`](https://github.com/smarchone/sim-xp/tree/main/.claude/skills/story-to-playbook) skill's command, `npx skills add smarchone/sim-xp --skill story-to-playbook -g`, with Copy; left out in the Claude artifact, where the chat writes playbooks), **Generate a playbook** (an example prompt for Claude Code, or the chat in the artifact) and **Load it** (Choose a file, or drop it on the page), and, once there is a playbook, a bar pinned at the bottom with its title, *✓ Ready to play* or its problems, and **Play**. A dropped file opens the drawer too. Each saved playbook is marked with when it was saved, with Export and Delete. On a phone the sidebar is a row of tabs above the list. Picking a playbook plays it and the **player** takes the whole window; **← All playbooks** in the player's header goes back to the index (the player pauses), and the browser's Back does too. While a playbook is loaded the index has a **▶ Continue** line with its title above the lede, back to the player, and its entry says *playing now*. The index has, top to bottom:

| Part | What it does |
|---|---|
| Library | Playbooks listed from GitHub repos (by default this repo's [`v3/playbooks`](https://github.com/smarchone/sim-xp/tree/main/v3/playbooks) folder, `smarchone/sim-xp@main/v3/playbooks`, read from GitHub so the site, the artifact and a copy opened from disk list the same playbooks; add any other with `owner/repo`). Each repo is a group of posts; the default repo's group has no heading while it is the only one (↻ refetches a list, remove drops an added repo). Click a title to play it. If GitHub cannot be reached, the default group shows the two bundled playbooks. Each list (`index.json`) is fetched fresh when the index first shows on a visit; each playbook you open is cached for a week, apart from Saved; the list of repos you added is kept too. |
| Saved | Up to 20 playbooks you made (written by Claude or opened from a file) kept in this browser's storage. Listed like the Library, shown only when there is something saved: click to play; Edit, Export and Delete sit under each one. |
| Add your own | In the drawer that **+ Add your own** (Your playground) opens. In the Claude artifact, a chat that asks Claude for a playbook or a change to the current one. Elsewhere, a one-line pointer to the `story-to-playbook` skill instead. |
| Your playbook | The steps give one playbook; the bar at the bottom of the drawer shows it: the title, *✓ Ready to play* or the problems to fix, and **Play**. Playing a playbook you made or changed keeps it under Local. Dropping a file on the page loads it too. |

In the player, Space plays and pauses, ←/→ jump between key moments, R opens the report, H switches Hardcore detail.

## Playbook repos (the Library)

A playbook repo is a folder of playbook `.json` files and an `index.json` next to them. The index fetches
`https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<folder>/index.json` when the Library opens, and a playbook only when it is clicked.
Add a repo as `owner/repo` (default branch, root folder), `owner/repo@branch/folder`, or paste its github.com link.

`index.json` is a list; each entry is one playbook. It is generated: for `v3/playbooks`, `node v3/tools/build-index.mjs` writes it from the playbook files and the v3 tests check it is current.

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

The address picks the playbook. A repo playbook's link always names its repo, the default library too: `#smarchone/sim-xp@main/v3/playbooks:<id>` or `#<owner/repo[@ref][/folder]>:<id>`, so it works for someone who has not added the repo and two repos can share an id. Links to the old default repo, `#smarchone/simxp-playbooks:<id>`, open the same playbook from `v3/playbooks`. A plain `#<id>` is a playbook in your Saved list (older links also fall back to the bundled two and the repos). Editing a repo playbook and running it saves a copy under a new id (`<id>-copy`). With no id the last playbook played opens.

## Develop

```sh
node v3/build-single.mjs         # build v3/dist/sim-xp.html (git-ignored)
open v3/dist/sim-xp.html         # runs from disk too, minus the Claude chat
python3 -m http.server 8000      # from the repo root: http://localhost:8000/v3/dist/sim-xp.html
node --test v3/test/*.test.mjs   # validator, bundled playbooks, and the build
```

Served from localhost (any static server whose root includes `v3/`), the index's sidebar adds a **Local server** library: the playbooks in `v3/playbooks/` (its `index.json`), read fresh each time with no cache, so a playbook you are writing plays as last saved. Its links are `#local:<id>`. It is left out when that folder cannot be reached, and never shows on GitHub Pages, from disk or in the Claude artifact.

### Recorded narration

A playbook's narration is recorded when the playbook is authored, never generated in the browser: Kokoro's Heart voice, one MP3 per playbook in `audio/<id>/` next to the playbooks (`v3/playbooks/audio/` for the default library), with a `manifest.json` giving each sentence's start and length in it. For a playbook from any library (the default repo, one you added, or the Local server), the player looks in `<library folder>/audio/<id>/`, the same place it fetched the playbook from, so it works on GitHub Pages, in the Claude artifact and on a local server alike. It plays in any browser and starts at once.

```sh
cd v3/tools && npm install && cd -                     # once: kokoro-js (the model, ~330 MB, downloads on the first run and is cached)
node v3/tools/gen-audio.mjs                            # every playbook in v3/playbooks; or name ids: … gen-audio.mjs kafka-rebalance-storm
node v3/tools/gen-audio.mjs --dir ../my-playbooks      # another library's folder (one with an index.json)
```

It needs Google Chrome (`CHROME=/path` to override) and `ffmpeg` with libmp3lame. The text comes from the player itself: each playbook is opened in headless Chrome, and `window.player.narration()` lists every sentence the narrator can say (Standard and Hardcore, Watch and Read), already rewritten for the ear. So rerun it after changing a playbook's text, or the spoken text and slide lines in `player.html`. Each sentence's audio is cached in `v3/tools/.cache/` (not in git) under a hash of the voice and the text, so a rerun only renders the sentences that changed (about 2 s each on the CPU), then rebuilds the playbook's MP3: its sentences back to back, 0.25 s apart, named by its content (`narration-<hash>.mp3`) so a browser never plays a stale copy. A full run also drops cached sentences no playbook says any more. Commit the `audio/` folder with the playbooks; regenerate once a playbook's text settles, since each run adds a new MP3 (about 3 MB) to the history (not Git LFS: raw.githubusercontent.com serves LFS pointers, not the files).

In the player, the playbook's MP3 is fetched and decoded once (about 3 MB), and each sentence plays as a slice of it. A sentence it lacks (a playbook edited since the last run), or a playbook with no `audio/` at all, is read by the Google voice where Chrome has one, and otherwise passes in silence for its reading time.

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
| `page/` | The page around the player: `page.html`, `page.css`, `page.js` (the index: Library, Saved, chat, playbook box, drop and export) |
| `js/playbook.js` | Symlink to the skill's validator (`../.claude/skills/story-to-playbook/scripts/playbook.js`), shared by the page, the skill and the tests |
| `js/tools.js` | WebMCP tools that let an agent drive a page that exposes them. Kept for reference, not part of the build |
| `playbooks/` | The default library: the playbooks, their `index.json` (generated by `tools/build-index.mjs`) and `audio/` (recorded narration, from `tools/gen-audio.mjs`). The build bundles only the default and the format example; the Kafka rebalance one is a symlink to the skill's example |
| `test/` | Tests: validator, bundled playbooks, the build |
| `../.claude/skills/story-to-playbook/` | The skill: format, authoring rules, one example, and the validator (`node scripts/validate.mjs pb.json [--at 60,120]`) |

## Adding a bundled playbook

Write it with the `story-to-playbook` skill (it validates), put the file in `playbooks/`, and add an entry to
`playbooks/index.json` (id, file, title, story, duration_s, tags, key_moments). The build bundles every entry, and a
new visitor finds it in the Saved list. `build-single.mjs` names which two playbooks are the box's default and
Claude's format example.

## With Claude Code

The skill is self-contained: the format and authoring rules, an example playbook, and the validator. Install it
and give it a story, then open the playbook file from the index's **Open file…** (or drop it on the page):

```sh
npx skills add smarchone/sim-xp --skill story-to-playbook -g
claude "/story-to-playbook why Postgres replicas fall behind during a big backfill"
```
