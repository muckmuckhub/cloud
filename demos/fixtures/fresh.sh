#!/usr/bin/env bash
# Usage: fresh.sh [fixture]
# Resets the one project every demo shares — the network called mynetwork —
# to an empty directory, or to a snapshot from fixtures/. Whatever was running
# there is taken down first.
set -e
dir=/tmp/cloud-demos/story/mynetwork
if [ -f "$dir/docker-compose.yml" ]; then
  (cd "$dir" && cloud down --volumes -y >/dev/null 2>&1) || true
fi
rm -rf "$dir" && mkdir -p "$dir"
if [ -n "$1" ]; then cp "/repo/demos/fixtures/$1.toml" "$dir/cloud.toml"; fi
# Nothing to prepare for ownership: the recorder runs as root, and `cloud
# apply` as root hands the servers' directories to the uid they run as.
