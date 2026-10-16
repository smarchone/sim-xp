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
playbooks, with no other files. That one file is both:

- **the GitHub Pages site**, at https://smarchone.github.io/sim-xp/ (also served at `/v2/`), and
- **a Claude artifact**, where the panel's chat can ask Claude (on the viewer's own Claude usage) to write a playbook.

The side panel (right, collapsible, resizable) has three parts:

| Part | What it does |
|---|---|
| Chat | Ask Claude for a playbook, or for a change to the one in the box. Only works in the Claude artifact; elsewhere it says so. |
| Playbook box | The JSON that **Run** plays. Paste into it, open a file, drop a file on the page, or let Claude write it. Shows the validator's result live. |
| Saved | Up to 20 playbooks kept in this browser's storage (the bundled examples are put there on a first visit; "Restore examples" puts them back). Click to load, ▶ to load and run, ⤓ to export, ✕ to delete. |

In the player, Space plays and pauses, ←/→ jump between key moments, R opens the report, H switches Hardcore detail.

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
| `playbooks/` | The bundled playbooks and `index.json` (the list the build bundles); the Kafka one is a symlink to the skill's example |
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
