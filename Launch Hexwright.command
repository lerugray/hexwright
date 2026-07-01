#!/bin/bash
# Launch Hexwright by double-clicking this file in Finder.
# Starts the local server if it isn't already running, then opens the editor
# in your default browser. Safe to double-click any number of times.
cd "$(dirname "$0")"

PORT=8642
is_hexwright() {
  curl -s -m 1 "http://localhost:$1/" | grep -qi hexwright
}

if ! is_hexwright "$PORT"; then
  # Something else on the port? Step to the next one.
  if curl -s -m 1 -o /dev/null "http://localhost:$PORT"; then
    PORT=8643
  fi
  if ! is_hexwright "$PORT"; then
    nohup python3 -m http.server "$PORT" >/dev/null 2>&1 &
    disown
    sleep 1
  fi
fi

open "http://localhost:$PORT/"
echo ""
echo "  Hexwright is running at http://localhost:$PORT"
echo "  You can close this window — the editor stays available."
echo ""
