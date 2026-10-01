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
```

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
```

`--dry-run` touches nothing at all, the secret included. See
[Scaling](scaling.md) for `--rolling` and [Forwarding](forwarding.md) for
`--rotate-secret`.

`apply` is convergent: running it twice changes nothing the second time.

A `cloud.toml` that cannot work is refused before anything starts, with
every problem listed and what to do about it:

<video src="assets/demos/validate.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud apply rejecting an invalid cloud.toml"></video>

### `cloud add [preset]`

<video src="assets/demos/add.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud add, then cloud add viaversion"></video>

With no argument, lists the available presets. With one, merges it into
`cloud.toml`, shows the diff, and waits for confirmation.

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

Proposes a change to `cloud.toml` as a diff, and stops. It never applies
anything and never calls Docker.

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
