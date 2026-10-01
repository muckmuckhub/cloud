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
# The recorder runs as root, so directories it creates are root-owned and the
# servers (uid 1000) could not write into them. On a real host they belong to
# whoever runs `cloud apply`. survival is static: its whole /data is here.
mkdir -p "$dir"/data/{proxy,lobby-1,lobby-2}/plugins "$dir"/data/survival
chmod -R 777 "$dir/data"
