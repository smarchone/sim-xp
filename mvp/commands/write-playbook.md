---
description: Turn an incident story or postmortem into a sim-xp playbook
argument-hint: "[story text or path to a postmortem]"
---

Turn the user's experience into a playable sim-xp drill.

1. Read the story: $ARGUMENTS. If it's thin, ask the user for the three things only they know: the misleading
   signal, the move they got wrong, and what finally worked.
2. Open `http://localhost:3000` with the webmcp tools and call `get_playbook_format`.
3. Draft the playbook: faults and timing that reproduce the dynamics (not scripted graphs), one red herring,
   the actions a responder would reach for, the author's runbook, and a debrief with `expert_path`, `pitfalls`
   and `lessons` in the user's own words.
4. `install_playbook` it and fix any validation errors. Then play it once with `start_drill` / `advance` /
   `take_action` and check the dynamics feel right: the wrong move should hurt, the right one should help.
5. Save the JSON to `mvp/playbooks/<id>.json`, add the id to `mvp/playbooks/index.json`, and show the user
   what you changed to make it feel true.
