---
description: Play a sim-xp drill in the browser through WebMCP
argument-hint: "[playbook id, optional]"
---

Play an incident drill through the sim-xp page's WebMCP tools, using the `webmcp` MCP server.

1. Open `http://localhost:3000` with `browser_open_page`. If it doesn't load, ask the user to run
   `python3 -m http.server 3000` in the `mvp/` folder.
2. `list_playbooks`, then `start_drill` with $ARGUMENTS (or the first playbook if none was given).
3. Play it like an on-call engineer: `advance` in small steps, read the dashboard, use `query_metrics` to look
   at slopes, and act with `take_action`, always with a short reason. Don't read the runbook first.
4. When the drill is over, call `get_debrief` and give the user a short summary: availability, time to
   mitigate, where you matched the author, and any trap you walked into.
