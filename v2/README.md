# sim-xp v2

Watch a system in motion. A story (a blog post, a postmortem, a one-line prompt) becomes a **playbook**, and
this page plays it: components light up, dashboards move, a feed scrolls, and playback pauses at the key
moments that explain what happened. A one-screen report closes the run.

```
story ──(Claude: the artifact's chat, or Claude Code + the story-to-playbook skill)──► playbook.json ──► the page plays it
```

v1 (the MVP in `../mvp`, now deprecated) let the learner operate the system. v2 drops that: nobody operates anything, the
playbook is played deterministically, and the experience is about how easy it is to follow.

## The app is one file

`node v2/build-single.mjs` writes `v2/dist/sim-xp.html`: the player, a collapsible side panel, and the bundled
two bundled playbooks (the default and the format example), with no other files. Every other playbook is loaded from a GitHub repo when you ask for it. That one file is both:

- **the GitHub Pages site**, at https://smarchone.github.io/sim-xp/v2/ (the site root is the docs page), and
- **a Claude artifact**, where the panel's chat can ask Claude (on the viewer's own Claude usage) to write a playbook.

The side panel (right, collapsible, resizable) has four parts:

| Part | What it does |
|---|---|
| Chat | Ask Claude for a playbook, or for a change to the one in the box. Only works in the Claude artifact; elsewhere it says so. |
| Playbook box | The JSON that **Run** plays. Paste into it, open a file, drop a file on the page, or let Claude write it. Shows the validator's result live. |
| Library | Playbooks listed from GitHub repos ([smarchone/simxp-playbooks](https://github.com/smarchone/simxp-playbooks) by default; add any other with `owner/repo`). Click to load into the box, ▶ to load and run. Nothing is copied into storage; only the list of repos you added is kept. |
| Saved | Up to 20 playbooks you made (written by Claude, pasted, or opened from a file) kept in this browser's storage. Click to load, ▶ to load and run, ⤓ to export, ✕ to delete. |

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

The address picks the playbook: `#<id>` looks in your Saved list, then the bundled two, then the default repo and any repos you added; `#<owner/repo[@ref][/folder]>:<id>` names the repo, so a link works for someone who has not added it. With no id the last playbook played opens.

## Develop

```sh
node v2/build-single.mjs         # build v2/dist/sim-xp.html (git-ignored)
open v2/dist/sim-xp.html         # runs from disk too, minus the Claude chat
node --test v2/test/*.test.mjs   # validator, bundled playbooks, and the build
```

## Update the artifact

The artifact is published from a Claude session; CI cannot do it. After changing the code:

1. `node v2/build-single.mjs`
2. In a Claude session on this repo, ask it to publish `v2/dist/sim-xp.html` to the existing artifact URL with capabilities
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
