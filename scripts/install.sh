#!/usr/bin/env sh
# Install the `cloud` CLI. Verifies the published checksum before installing.
#
# Published as a release asset by .github/workflows/ci.yml, which stamps the
# release tag in as the default CLOUD_VERSION. A pinned installer therefore
# installs the release it shipped with, rather than whatever is newest.
set -eu

REPO="${CLOUD_REPO:-muckmuckhub/cloud}"
VERSION="${CLOUD_VERSION:-latest}"
BIN_DIR="${CLOUD_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Linux)  os=linux ;;
  Darwin) os=darwin ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
[ "$os" = darwin ] && [ "$arch" = x64 ] && {
  echo "darwin-x64 is not published; use Rosetta or build from source" >&2; exit 1; }

asset="cloud-${os}-${arch}"
if [ "$VERSION" = latest ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${asset}..."
curl -fsSL "${base}/${asset}"        -o "$tmp/cloud"
curl -fsSL "${base}/${asset}.sha256" -o "$tmp/cloud.sha256"

echo "Verifying checksum..."
( cd "$tmp" && sed "s|${asset}|cloud|" cloud.sha256 > c && \
  if command -v sha256sum >/dev/null; then sha256sum -c c
  else shasum -a 256 -c c; fi )

mkdir -p "$BIN_DIR"
mv "$tmp/cloud" "$BIN_DIR/cloud"
chmod +x "$BIN_DIR/cloud"

echo "Installed to $BIN_DIR/cloud"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add it to your PATH:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
echo
echo "Next:  mkdir mynetwork && cd mynetwork && cloud init"
