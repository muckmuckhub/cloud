# Install

## Requirements

Docker is the only runtime dependency.

| Platform | What you need |
|---|---|
| Linux | Docker Engine |
| macOS | Docker Desktop |
| Windows | Docker Desktop with the WSL 2 backend — see [Windows](windows.md) |

The `cloud` binary is self-contained: no Java, no Node, no Python. Java runs
inside the containers, and the right version is chosen for you from the
Minecraft version.

## Binary

Linux and macOS:

```sh
curl -fsSL https://github.com/muckmuckhub/cloud/releases/latest/download/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://github.com/muckmuckhub/cloud/releases/latest/download/install.ps1 | iex
```

Releases are built in CI for linux-x64, linux-arm64, darwin-arm64 and
windows-x64, each with a SHA-256 checksum and a build provenance attestation.
The installer downloads the asset for your platform from GitHub Releases and
refuses to install it if the checksum does not match.

### Reading it first

Piping a script into a shell is worth being suspicious of. Both scripts are
short and do nothing clever, and you can read the one you are about to run:

```sh
curl -fsSL https://github.com/muckmuckhub/cloud/releases/latest/download/install.sh            # read it
curl -fsSL https://github.com/muckmuckhub/cloud/releases/latest/download/install.sh | sh       # then run it
```

Both are published as assets on each release, so you can pin the installer as
well as the version it installs:

```sh
curl -fsSL https://github.com/muckmuckhub/cloud/releases/download/v0.2.0/install.sh | sh
```

A pinned installer installs the release it shipped with. The `latest` URL
installs the newest release. Either way `CLOUD_VERSION` overrides it.

They also live in the repository under `scripts/`, which is the copy that gets
reviewed; the release asset is built from it.

### Environment overrides

Both installers honour the same variables:

| Variable | Default | Purpose |
|---|---|---|
| `CLOUD_VERSION` | `latest` | Install a specific tag, e.g. `v0.2.0` |
| `CLOUD_BIN_DIR` | `~/.local/bin`, or `%LOCALAPPDATA%\Programs\cloud` | Where to put the binary |
| `CLOUD_REPO` | `muckmuckhub/cloud` | Install from a fork |

```sh
CLOUD_VERSION=v0.2.0 CLOUD_BIN_DIR=/usr/local/bin curl -fsSL https://github.com/muckmuckhub/cloud/releases/latest/download/install.sh | sh
```

## From source

Needs [Bun](https://bun.sh).

```sh
git clone https://github.com/muckmuckhub/cloud && cd cloud
bun install
bun run build          # produces dist/cloud, or dist/cloud.exe on Windows
```

## Verify

```sh
cloud --version
docker info            # must succeed; cloud shells out to it
```

If `docker` is not found, `cloud` says so and points at the installer for your
platform. On Windows the Docker CLI is only on `PATH` while Docker Desktop is
running, which is the most common cause of that message.
