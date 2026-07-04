#!/bin/bash
# Launch Hexwright by double-clicking this file in Finder.
# Serves from the PARENT folder so sibling repos (full-res maps, traces, TWU
# checkouts) are reachable via ../<repo>/ paths in local manifests, then opens
# the editor. Safe to double-click any number of times.
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_NAME="$(basename "$HERE")"
cd "$HERE/.."

PORT=8642
is_hexwright() {
  curl -s -m 1 "http://localhost:$1/$REPO_NAME/" | grep -qi hexwright
}

if ! is_hexwright "$PORT"; then
  # Something else (or an old single-repo server) on the port? Step once.
  if curl -s -m 1 -o /dev/null "http://localhost:$PORT"; then
    PORT=8643
  fi
  if ! is_hexwright "$PORT"; then
    nohup python3 "$HERE/scripts/serve_nocache.py" "$PORT" >/dev/null 2>&1 &
    disown
    sleep 1
  fi
fi

URL="http://localhost:$PORT/$REPO_NAME/"
# Boot straight into the full-res local project when the manifest exists.
if [ -f "$HERE/local/gota-fullres.json" ]; then
  URL="${URL}?project=local/gota-fullres.json"
fi

open "$URL"
echo ""
echo "  Hexwright is running at $URL"
echo "  You can close this window — the editor stays available."
echo ""
