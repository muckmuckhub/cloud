# Commands

Ten commands. An eleventh is a design question first, which is why rotating the
forwarding secret is a flag on `apply` rather than a command of its own.

Two flags are shared:

- `--context <name>` targets a remote host through a Docker context. Every
  command that talks to Docker honours it.
- `-y` / `--yes` skips confirmation prompts: `apply`, `add`, `ask`, `down`.

Flags may come before or after positional arguments, so
`cloud logs --context prod lobby` and `cloud logs lobby --context prod` are the
same command.

## Setup

### `cloud init`

<video src="assets/demos/init.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud init --manual"></video>

Creates `cloud.toml` in the current directory. Conversational if an AI provider
is configured, prompts otherwise.

```sh
cloud init
cloud init --manual              # skip the AI wizard even if a provider exists
cloud init --prompt "velocity proxy, 3 paper lobbies, one survival"
cloud init --from ../mynetwork --version 26.2   # a second network from a blueprint
```

`--from` takes any `cloud.toml` — a file, a project directory, or a URL — and
gives the new network its own name and a free port, so it runs beside the
others. See [Versions and blueprints](versions.md).

Without a provider it asks for the network name, port, MOTD and Minecraft
version, then each server: its memory, whether it is *pooled* (lobbies,
minigames) or *single* (survival — its own browsable directory), and for a
pooled group how many instances to run. That defaults to 2: the smallest
group that keeps players when one instance goes down, and the minimum for
a rolling restart.

Also creates `templates/` and a `.gitignore` covering secrets, worlds and
generated files. Refuses to run if `cloud.toml` already exists.

### `cloud apply`

<video src="assets/demos/apply.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud apply --dry-run, then cloud apply"></video>

Renders the generated files, shows a diff, asks, then reconciles with
`docker compose up -d --remove-orphans`.

```sh
cloud apply
cloud apply --dry-run            # stop at the diff, write nothing
cloud apply --rolling            # cycle multi-instance groups one at a time
cloud apply --rotate-secret      # new forwarding secret, then restart
cloud apply --version 26.2       # switch every group, written into cloud.toml
cloud apply --recreate           # delete every world, build again (asks)
cloud apply --no-wait            # return once the containers have started
```

`apply` waits until players can actually join — the proxy and the fallback
group ready — and shows each server's progress meanwhile: downloading,
installing plugins, generating the world, ready. See
[Versions and blueprints](versions.md) for `--version` and `--recreate`.

`--dry-run` touches nothing at all, the secret included. See
[Scaling](scaling.md) for `--rolling` and [Forwarding](forwarding.md) for
`--rotate-secret`.

`apply` is convergent: running it twice changes nothing the second time.

Before asking, it warns about two things that are still avoidable at that
point:

- **Recreating a multi-instance group all at once** — when an existing
  network's compose file changes, every player on that group would drop.
  It suggests `--rolling`. A first apply, with nothing running yet, does
  not warn.
- **Not enough memory in Docker** — when the network's memory caps add up
  to more than Docker has, the servers start and are then killed one by
  one as their heaps fill. On Docker Desktop the limit is the VM's; see
  [Windows](windows.md#memory).

A `cloud.toml` that cannot work is refused before anything starts, with
every problem listed and what to do about it:

<video src="assets/demos/validate.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud apply rejecting an invalid cloud.toml"></video>

### `cloud add [preset]`

<video src="assets/demos/add.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud add, then cloud add viaversion"></video>

With no argument, lists the available presets. With one, merges it into
`cloud.toml`, shows the diff, and waits for confirmation. The diff shows the
lines that change, with one line of context — not the whole file.

A preset that installs plugins on every group skips Fabric and NeoForge
servers, which cannot load them; environment variables still reach them.

`cloud add` edits `cloud.toml` in place: it changes only the lines the preset
needs and leaves your comments, blank lines and alignment exactly as they
were. A new key goes after the last key of its table, lined up with its
neighbours; a new group or table is written the way `cloud init` would.
Running the same preset twice changes nothing.

It edits `[table]` headers and `key = value` lines. A file written with
inline tables (`env = { ... }`), dotted keys (`env.MODE = ...`) or arrays of
tables cannot always be edited that way; then `cloud add` says so before it
asks, and writing would replace the file with its canonical form. Every
in-place edit is checked before anything is written: the result must mean
exactly the new config, or it is not used.

```sh
cloud add                        # list them
cloud add geyser                 # Bedrock crossplay
```

See [Presets](presets.md).

## Operating

### `cloud status`

<video src="assets/demos/status.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud status and cloud status --json"></video>

What is running, how many players are on it, and what should be running but
isn't.

```
mynetwork · port 25565 · modern forwarding

SERVICE   STATE    HEALTH   PLAYERS  UPTIME
proxy     running  healthy  -        2 hours
lobby-1   running  healthy  12/20    2 hours
lobby-2   running  healthy  3/20     2 hours

  15 players online

  not running: survival
  try: cloud logs survival
```

Player counts come from each backend's `list` command over RCON. The proxy has
no RCON, so it shows `-`, as does a server that is still starting or does not
answer within 10 seconds. A server that cannot be asked never fails `status`.

#### `cloud status --json`

The same information as JSON on stdout and nothing else, for scripts and
monitoring:

```json
{
  "version": 1,
  "network": "mynetwork",
  "entry_port": 25565,
  "forwarding": "modern",
  "services": [
    {
      "name": "lobby-1",
      "group": "lobby",
      "state": "running",
      "health": "healthy",
      "uptime": "2 hours",
      "players": { "online": 12, "max": 20, "names": ["alice", "bob"] }
    }
  ],
  "missing": ["survival"]
}
```

`version` is the version of this format. It is bumped if a field changes
meaning or is removed; new fields may appear without a bump. `group` is `null`
for the proxy. `health` and `players` are `null` when unknown.

```sh
cloud status --json | jq '[.services[].players.online // 0] | add'
```

### `cloud logs [server] [-f] [--tail N]`

<video src="assets/demos/logs.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud logs, then cloud logs -f"></video>

Shows the last 200 lines, or `--tail N`. Defaults to the proxy.

```sh
cloud logs                       # the proxy
cloud logs lobby-1 --tail 50     # the last 50 lines of one backend
cloud logs lobby-1 -f --tail 5   # follow it, starting from the last 5
```

### `cloud exec <server> "<command>"`

<video src="assets/demos/exec.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud exec running console commands"></video>

Runs a Minecraft console command over RCON.

```sh
cloud exec lobby-1 "say restarting in 60s"
cloud exec survival "save-all"
```

### `cloud restart [server]`

<video src="assets/demos/restart.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud restart lobby --rolling"></video>

```sh
cloud restart                    # everything
cloud restart lobby-1            # one service
cloud restart lobby --rolling    # a group, one instance at a time
```

`--rolling` waits for each instance to report healthy before taking the next
one down.

Use `cloud restart` to pick up a change to files (a plugin jar, a template).
Use `cloud apply` for a change to `cloud.toml` — a plain restart reuses the
existing container definition, so a config change would not take effect.

### `cloud down`

<video src="assets/demos/down.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud down, and cloud down --volumes asking first"></video>

```sh
cloud down                       # stop everything, keep all data
cloud down --volumes             # also delete every world. Asks first.
```

`--volumes` is the only destructive command here, and it says so before doing
anything.

## Assisted (optional)

These two need an AI provider. Everything above works without one.

### `cloud ask "<request>"`

Proposes a change to `cloud.toml` as a diff. If you confirm, it writes
`cloud.toml` — and stops there: it never applies anything and never calls
Docker. `cloud apply` is still your step.

Like `cloud add`, it edits the file in place — the model returns a whole
config, but only the values that differ are written back, and your comments
and layout stay.

```sh
cloud ask "add a creative server with 2G"
```

### `cloud explain <server>`

Reads the last 200 log lines and says what went wrong in plain language.

```sh
cloud explain lobby-1
```

See [AI features](ai.md).

## Exit codes and errors

Every command exits non-zero on failure and prints what to do next rather than
only what broke:

```
error no cloud.toml found here or in any parent directory.
Run `cloud init` to create one.
```

`cloud` walks up from the current directory to find `cloud.toml`, the way `git`
finds `.git`, so commands work from anywhere inside the project.

Set `CLOUD_DEBUG=1` for a stack trace.
