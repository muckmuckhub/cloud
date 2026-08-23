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

### `cloud add [preset]`

With no argument, lists the available presets. With one, merges it into
`cloud.toml`, shows the diff, and waits for confirmation.

```sh
cloud add                        # list them
cloud add geyser                 # Bedrock crossplay
```

See [Presets](presets.md).

## Operating

### `cloud status`

What is running, and what should be but isn't.

```
mynetwork · port 25565 · modern forwarding

SERVICE   STATE    HEALTH   UPTIME
proxy     running  healthy  2 hours
lobby-1   running  healthy  2 hours
lobby-2   running  healthy  2 hours

  not running: survival
  try: cloud logs survival
```

### `cloud logs [server] [-f]`

Tails the last 200 lines. Defaults to the proxy.

```sh
cloud logs                       # the proxy
cloud logs lobby-1 -f            # follow one backend
```

### `cloud exec <server> "<command>"`

Runs a Minecraft console command over RCON.

```sh
cloud exec lobby-1 "say restarting in 60s"
cloud exec survival "save-all"
```

### `cloud restart [server]`

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
