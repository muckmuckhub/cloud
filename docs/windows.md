# Windows

`cloud` runs natively on Windows. You need Docker Desktop with the **WSL 2
backend** (Settings → General → "Use the WSL 2 based engine"). The Hyper-V
backend works but is slower for the same reason bind mounts are.

## Install

```powershell
irm https://github.com/muckmuckhub/cloud/releases/latest/download/install.ps1 | iex
```

Then:

```powershell
mkdir mynetwork; cd mynetwork
cloud init
cloud apply
```

## Native Windows or WSL?

Both work. The difference is where your world files live.

| | Native Windows | Inside WSL |
|---|---|---|
| Install | `install.ps1` | `install.sh` |
| Terminal | Windows Terminal / PowerShell 7 | any |
| World I/O | fast with `storage = "volume"` | fast on the ext4 side |
| Browsing world files | `\\wsl$\...` or `docker cp` | normal file access |

If you already live in WSL, use it. If you don't, native Windows is fine —
there is no reason to install WSL just for this, since Docker Desktop brings
its own.

**One thing to avoid either way:** running the project from `/mnt/c/...` inside
WSL. That routes every world write through the Windows drive bridge and is the
slowest of all the options. `cloud` warns when it detects this. Keep the
project in `~` instead.

## Storage

```toml
[network]
storage = "volume"   # default on Windows
```

`storage = "bind"` puts persistent worlds in `./data/<server>` where Explorer
can open them. On Docker Desktop that directory is on the Windows filesystem
while the server runs inside a Linux VM, so every chunk save crosses a
filesystem bridge. On a busy survival server that is enough to cause visible
stutter.

`storage = "volume"` keeps the data inside the VM. Much faster, at the cost of
not being able to double-click into the folder. To get files out:

```powershell
docker cp mynetwork-survival:/data/world .\world-backup
```

`cloud init` picks `volume` for you on Windows. It is written into
`cloud.toml`, not inferred at runtime — the same config file produces the same
containers on every machine, which is the point of the design.

## Console output

Colours and symbols work in **Windows Terminal**, **PowerShell 7**, and the
VS Code terminal. Legacy `cmd.exe` runs a non-UTF-8 codepage, so `cloud`
detects it and falls back to ASCII (`+` instead of `✓`) rather than printing
mojibake. Set `NO_COLOR=1` to disable colour entirely.

## File permissions

`proxy/forwarding.secret` is your network's shared secret. On Linux and macOS
it is written mode `0600`. Windows has no such mode — Node's `chmod` there only
toggles the read-only flag — so `cloud` runs `icacls` to strip inherited
permissions and grant access to your account only.

If that fails (unusual domain setups, restricted policies), `cloud` continues
but the file keeps its inherited ACL. On a shared machine, check it:

```powershell
icacls proxy\forwarding.secret
```

## Line endings

`.gitattributes` forces LF on `docker-compose.yml`, `*.toml`, `*.yml` and
`*.sh`, because those files are read inside Linux containers and a CRLF in the
wrong place produces confusing failures. Don't override this with
`core.autocrlf=true` for this repo.

## Memory

Docker Desktop runs every container in one WSL 2 VM, and that VM gets a
fixed share of your RAM — set in `%USERPROFILE%\.wslconfig`, not in
Docker Desktop:

```ini
[wsl2]
memory=10GB
```

Then quit Docker Desktop completely (tray icon → Quit), run
`wsl --shutdown`, and start Docker Desktop again.

Each server needs a bit more than its `memory` (the JVM heap): a `1G`
Paper server sits at about 1.25G. `cloud apply` adds up the network's
memory caps and warns when they exceed what Docker has. Take the warning
seriously on WSL: a WSL VM that runs out of memory does not kill one
process the way a Linux host would. It swaps until the whole VM stops
answering — Docker, every container, and any Linux distro you use — and
Docker Desktop reports `500 Internal Server Error` for everything.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker not found on PATH` | Docker Desktop isn't running. Its CLI is only on PATH while the engine is started. |
| `cannot reach the Docker engine` | Wait for Docker Desktop to show "Engine running". |
| Boxes or `?` instead of symbols | Legacy `cmd.exe`. Use Windows Terminal, or ignore it — output is still readable. |
| Worlds save slowly, players see lag | `storage = "bind"` on a Windows path. Switch to `volume` and re-run `cloud apply`. |
| `cloud` not recognised after install | Open a new terminal; PATH changes don't apply to existing sessions. |
| Port 25565 already in use | Something else is bound to it. Change `entry_port` in `cloud.toml`. |
| Every docker command answers `500 Internal Server Error`, or hangs | The WSL VM ran out of memory and froze. Quit Docker Desktop, `wsl --shutdown`, start it again — then give the VM more memory or the network less. See [Memory](#memory). |
| Docker Desktop does not start after `wsl --shutdown` | The previous instance is still running without its VM. Quit it from the tray icon (or end `Docker Desktop` in Task Manager), then start it again. |

## Not supported

- **Windows containers.** Docker Desktop must be in Linux-container mode
  (the default). Minecraft server images are Linux-only.
- **Windows on ARM64 native binary.** The x64 build runs under emulation.
  Build from source with Bun for a native one.
