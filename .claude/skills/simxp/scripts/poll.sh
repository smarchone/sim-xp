#!/usr/bin/env bash
# Wait for the next chat job from sim-xp's local server, print it as JSON, and exit.
# A Claude Code session runs this in the background; the job arriving (this script exiting) wakes it up.
#
#   poll.sh
#
# Exit codes: 0 = printed a job, 1 = server unreachable for about a minute (a restart of the server is ridden out).
# SIMXP_URL overrides the server address (default http://127.0.0.1:3470).
set -u
URL="${SIMXP_URL:-http://127.0.0.1:3470}"

# If this script is stopped (session closed, TaskStop), take the in-flight request down with it, so the server
# sees the hang-up and shows Claude as not listening. curl runs in the background + `wait` so traps fire at once.
CURL_PID=
OUT=$(mktemp)
cleanup() { [[ -n "$CURL_PID" ]] && kill "$CURL_PID" 2>/dev/null; rm -f "$OUT"; }
trap cleanup EXIT
trap 'exit 143' TERM INT HUP

fails=0
while true; do
  # The server holds each request up to 300 s and answers as soon as a chat message is waiting
  curl -sf --max-time 320 "$URL/api/jobs/next?timeout=300" >"$OUT" &
  CURL_PID=$!
  if wait "$CURL_PID"; then ok=1; else ok=0; fi
  CURL_PID=
  r=$(<"$OUT")
  if (( ! ok )); then
    fails=$((fails + 1))
    if (( fails > 20 )); then  # about a minute: long enough for the server to be restarted
      echo "sim-xp server not reachable at $URL. Start it with: node v3/server.js. Poller stopped."
      exit 1
    fi
    sleep 3
    continue
  fi
  fails=0
  if [[ "$r" != *'"job":null'* ]]; then
    echo "$r"
    exit 0
  fi
done
