#!/usr/bin/env bash
# Usage: up.sh <fixture>
# Makes sure the shared network is running the given snapshot of the story,
# and waits — off camera — until every server is healthy. After a full run the
# previous tape has already left it in that state and this is quick; recording
# one tape alone, it builds the state from scratch.
set -e
dir=/tmp/cloud-demos/story/mynetwork
want="/repo/demos/fixtures/$1.toml"
if [ ! -f "$dir/cloud.toml" ]; then
  bash /repo/demos/fixtures/fresh.sh "$1"
elif ! cmp -s "$want" "$dir/cloud.toml"; then
  cp "$want" "$dir/cloud.toml"
fi
cd "$dir"
cloud apply -y >/dev/null 2>&1
running() { docker compose ps -q | wc -l; }
healthy() { docker ps --filter label=com.docker.compose.project=mynetwork --filter health=healthy -q | wc -l; }
until [ "$(running)" -gt 0 ] && [ "$(healthy)" -eq "$(running)" ]; do sleep 2; done
