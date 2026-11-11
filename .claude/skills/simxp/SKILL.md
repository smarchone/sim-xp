---
name: simxp
description: Work as the chat worker behind sim-xp's local server (node v3/server.js). Waits in the background for chat messages from the browser, writes new playbooks or changes existing ones in v3/playbooks/ with the story-to-playbook skill, and replies in the chat (the server then records the narration in the background). Use when the user runs /simxp or asks Claude to start listening to the sim-xp chat.
---

You are the worker behind **sim-xp's chat**, in this repo. The person chats in the browser, on the index (under
**Local server**: "simulate this story") or in the player (**Chat**, beside Events: "change this playbook"). Their
waiting messages become **jobs**. You answer each job by writing `v3/playbooks/<id>.json`; the server sees the file,
the list updates and an open player reloads at the same place.

## Setup

1. Check the server is up: `curl -sf "${SIMXP_URL:-http://127.0.0.1:3470}/api/health"`. If it isn't, tell the person to
   run `node v3/server.js` in this repo and stop. Otherwise tell them the URL in one line.
2. Load the **story-to-playbook** skill with the Skill tool, once, before your first job. It is how you write every
   playbook: the format, the authoring rules, the example and the validator. Follow it, with the file locations below
   in place of its own.
3. The poller is `scripts/poll.sh` in this skill's folder. Run it by its absolute path. It waits for the next job,
   prints it as JSON and exits.

## Loop

1. Start the poller with the Bash tool and `run_in_background: true`. Don't read its output while it runs; you're
   woken when it exits. Stay idle and silent meanwhile.
2. When it exits:
   - Exit 0 with a job: handle it (below), then go back to step 1.
   - Exit 1 (server unreachable for about a minute; a quick restart of the server is ridden out): print the poller's
     message and stop. Don't retry or restart anything.
3. If the person says to stop, stop the background poller with TaskStop and end.

## A job

```json
{"job":{"id":"…","thread":"new"|"<playbook id>","playbook":null|"<id>","file":null|"/abs/v3/playbooks/<id>.json",
  "playbooks_dir":"/abs/v3/playbooks","repo":"/abs/repo",
  "messages":[{"text":"…","at":"…"}],"context":[{"author":"user"|"claude","text":"…"}]}}
```

`messages` are the person's new messages: act on all of them; the last one wins on conflicts. `context` is the earlier
conversation in this thread. Questions only: answer, no edits. Truly ambiguous: ask one concrete question, no edits.

Post a short status line when a step will take a while (the person sees it in the chat):

```bash
curl -sf -X POST "${SIMXP_URL:-http://127.0.0.1:3470}/api/jobs/progress" -H 'Content-Type: application/json' -d '{"job_id":"<id>","text":"Writing the playbook…"}'
```

### A new playbook (`playbook: null`, from the index)

1. Write it with story-to-playbook (read its example first, plan the arc, write, observe the world with the validator,
   fix until clean). Pick `meta.id`: kebab-case, and not already a file in `playbooks_dir`.
2. Work on a copy, never in `playbooks_dir`: `v3/tools/.cache/work/<id>.json` (not in git). Validate it there:
   `node .claude/skills/story-to-playbook/scripts/validate.mjs v3/tools/.cache/work/<id>.json`.
3. Only once it validates, move it into place in one step, so the page never sees half a file:
   `mv v3/tools/.cache/work/<id>.json "<playbooks_dir>/<id>.json"`.
4. Complete the job (below) with `"playbook":"<id>"`. The index shows it with a Play link.

### A change to a playbook (`playbook: "<id>"`, from the player)

1. Read `file`. Copy it to `v3/tools/.cache/work/<id>.json` and make the change there, following story-to-playbook's
   rules (keep the arc coherent: if a curve moves, the notes, the alerts and the report that cite it move too). Keep
   `meta.id`.
2. Validate the copy, fix until clean, then `mv` it over `file`. The player reloads at the same place.
3. Complete the job.

### Complete (posts your reply in the chat)

```bash
curl -sf -X POST "${SIMXP_URL:-http://127.0.0.1:3470}/api/jobs/complete" -H 'Content-Type: application/json' -d @- <<'JSON'
{"job_id":"<id>","playbook":"<id, required for a new playbook>","reply":"<1–3 sentences: what you wrote or changed, and anything you invented>"}
JSON
```

If you only answered a question and changed no file, add `"changed": false`.

Then go straight back to the loop. **Don't record the narration yourself**: when a job completes having written or changed a
playbook, the server records it in the background with `v3/tools/gen-audio.mjs` (Kokoro's Heart voice, only the
sentences that changed) and posts "Recording the narration…" and "Narration recorded." in that playbook's chat; the
player picks up the recording by itself, and reads new sentences with a Google voice until then.

409 means the job is no longer yours (the person pressed **Stop** in the chat, or another worker took it over): drop it,
leave what you wrote as it is, and keep listening.

A job can come back to you after a restart: if this session (or an earlier one) was stopped mid-job, the server hands the
same job to the next poll, with "Claude was restarted and is picking this up again." in the chat. Check `playbooks_dir`
and `v3/tools/.cache/work/` for what was already written, finish from there, and complete it as usual.

Terminal output: at most one line per job. The conversation happens in the chat.
