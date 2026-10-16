# AGENTS.md

sim-xp turns a story into a **playbook** (JSON) that a single-page player animates. Active code is in `v2/`; `mvp/` is deprecated. Read `v2/README.md` for the layout.

## Test

Run before every commit and PR. CI (`.github/workflows/pages.yml`) runs the same command and blocks the Pages deploy if it fails:

```sh
node --test v2/test/*.test.mjs
```

- Needs only Node, no install step.
- It checks the validator, that every bundled playbook validates, and the single-file build.
- Validate one playbook: `node .claude/skills/story-to-playbook/scripts/validate.mjs pb.json [--at 60,120]`.
- Adding or removing a playbook in `v2/playbooks/` means updating `v2/playbooks/index.json` (id, file, title, story, duration_s, tags, key_moments). `key_moments` is the count of timeline entries with a `beat`. The test fails if the index and the files disagree.
- Tests that need a playbook should read one that exists today; do not hardcode a playbook you may delete.

## Build the single file (Claude artifact and Pages site)

The app ships as ONE html file: player, side panel, validator and all bundled playbooks.

```sh
node v2/build-single.mjs        # writes v2/dist/sim-xp.html (git-ignored)
open v2/dist/sim-xp.html        # works from disk, except the Claude chat
```

- The build fails loudly if source snippets it patches have drifted; fix the source, do not loosen the patch.
- `build-single.mjs` names the default playbook (`DEFAULT_ID`) and the format example Claude reads (`EXAMPLE_ID`). Both must be in `index.json`.
- Edit `v2/player.html`, `v2/sidebar/*` or `v2/playbooks/*`, never `v2/dist/`.

### Publish as a Claude artifact

CI cannot publish the artifact; do it from a Claude session after merging to `main`:

1. `node --test v2/test/*.test.mjs && node v2/build-single.mjs`
2. Publish `v2/dist/sim-xp.html` to the **existing** artifact URL (update in place, so the link stays the same) with capabilities `{sample: {}, downloads: true}`. The side-panel chat needs `sample`; export needs `downloads`.
3. The file has no `<html>/<head>/<body>` tags on purpose (the publisher adds its skeleton). Keep external loads to Google Fonts.
4. Keep the file under the 16 MB artifact limit.

GitHub Pages deploys itself on every push to `main`.

## Conventions

- Playbooks are written with the `story-to-playbook` skill (`.claude/skills/story-to-playbook/`), which also holds the format reference and the validator that `v2/js/playbook.js` symlinks to.
- Work on a branch and open a PR; do not push to `main`.
