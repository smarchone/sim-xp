# sim-xp v2

Watch a system in motion. A story (a blog post, a postmortem, a one-line prompt) becomes a **playbook**, and
this page plays it: components light up, dashboards move, a feed scrolls, and playback pauses at the key
moments that explain what happened. A one-screen report closes the run.

```
story ──(Claude Code + story-to-playbook skill)──► playbook.json ──(drop it on the page)──► this page plays it
```

v1 (the MVP in `../mvp`) let the learner operate the system. v2 drops that: nobody operates anything, the
playbook is played deterministically, and the experience is about how easy it is to follow.

## Run it

Live at **https://smarchone.github.io/sim-xp/v2/**. Locally there is no build step:

```sh
cd v2
python3 -m http.server 3000      # open http://localhost:3000
```

Pick a bundled playbook or drop a playbook `.json` on the page. Space plays and pauses, ←/→ jump between key
moments, R opens the report.

Tests: `node --test v2/test/*.test.mjs`

## With Claude Code

Download the `story-to-playbook` skill once (rerun to update), give it a story, then drop the playbook file it
writes on the page:

```sh
npx degit smarchone/sim-xp/.claude/skills/story-to-playbook ~/.claude/skills/story-to-playbook --force
claude "/story-to-playbook why Postgres replicas fall behind during a big backfill"
```

The skill is self-contained: the format and authoring rules, four example playbooks, and the validator.
A clone of this repo has it already, in `.claude/skills/story-to-playbook`.

The page also registers WebMCP tools, so an agent with the
[WebMCP bridge](https://github.com/smarchone/webmcp-apps) can load and play a playbook itself. The page's tools:

| Tool | What it does |
|---|---|
| `get_guide` | What the page does and the workflow |
| `list_playbooks` | The bundled playbooks |
| `validate_playbook` | Errors, warnings, and the world at each key moment and when alerts fire |
| `load_playbook` | Validate, then load into the player (from `{"$file": "..."}`, JSON, or a bundled id) |
| `control` | Start, pause, seek, jump to a key moment, report, speed |
| `get_state` | Playback position and the world at any second: values, firing alerts, component effects, feed |
| `wait_for` | Wait until playback pauses at a key moment or ends |
| `get_playbook` | The loaded playbook's JSON |

## What's in it

| Path | What it is |
|---|---|
| `index.html`, `js/app.js` | The page: library, file drop, player frame, WebMCP tools |
| `player.html` | The player. It plays the playbook its host page hands it, and exposes `window.player` for playback |
| `js/playbook.js` | Validation and the noise-free simulation, shared by the page and the CLI |
| `js/tools.js` | The WebMCP tools |
| `tools/validate.mjs` | `node v2/tools/validate.mjs pb.json [--at 60,120]` |
| `playbooks/` | Four playbooks and `index.json` |
| `../.claude/skills/story-to-playbook/` | The skill: format, authoring rules, examples, and a copy of the validator |
