# cloud

Run a Minecraft network from one config file. No dashboard, no daemon, no database.

**The AI setup wizard is optional.** Every command works with no API key and no
internet. If you want the conversational setup, point it at Anthropic or at a
local model via Ollama — your choice, and neither is required.

```
internet ──▶ :25565 ──▶ velocity ──┬──▶ lobby
                                   └──▶ survival
```

![cloud apply: from one file to a running network](docs/assets/demos/apply.gif)

**Documentation:** https://muckmuckhub.github.io/cloud — install, configuration
reference, scaling, forwarding, troubleshooting. Source under [docs/](docs/).

## Why

Existing Minecraft cloud systems are applications you talk to, which is why
they grow dashboards, permission systems, module ecosystems, and 200-class Java
APIs — and then spend years in release-candidate limbo maintaining all of it.

This one inverts that. Desired state lives in a file. `cloud apply` makes
reality match. The CLI edits files and reads state; it is not a control plane.

## Install

**Linux / macOS**
```sh
curl -fsSL https://github.com/muckmuckhub/cloud/releases/latest/download/install.sh | sh
```

**Windows** (PowerShell)
```powershell
irm https://github.com/muckmuckhub/cloud/releases/latest/download/install.ps1 | iex
```

Both fetch a single binary from GitHub Releases and verify its published
SHA-256 before installing. No runtime, no package manager.

Or from source (needs [Bun](https://bun.sh)):

```sh
git clone https://github.com/muckmuckhub/cloud && cd cloud
bun install && bun run build
```

You also need Docker. That is the only runtime dependency — Docker Engine on
Linux, or Docker Desktop with the WSL 2 backend on Windows and macOS.
See [docs/windows.md](docs/windows.md) for Windows specifics.

## Use

```sh
mkdir mynetwork && cd mynetwork
cloud init            # conversational if an AI provider is set, prompts if not
cloud apply           # renders files, shows a diff, waits for you, reconciles
cloud status
```

`cloud init` with a provider configured:

```
? Describe the network you want:
  velocity proxy, a paper 1.21.10 lobby and a paper 1.21.10 survival server

? Which port should players connect to? (25565)
? How much RAM for the survival server? (4G)
? Which server should players land on when they join? (lobby)

cloud.toml
  [network]
  name       = "mynetwork"
  ...

Write this config? [Y/n]
```

The model never writes YAML or TOML. It fills a typed schema via tool call;
deterministic code renders the files. A hallucinated field is a parse error,
not a broken deploy.

## Commands

| | |
|---|---|
| `cloud init` | Create `cloud.toml`. `--manual` skips the AI wizard. |
| `cloud apply` | Render, diff, confirm, reconcile. `--dry-run` stops at the diff. |
| `cloud apply --rolling` | Update multi-instance groups one instance at a time. |
| `cloud apply --rotate-secret` | New forwarding secret, then restart every backend. |
| `cloud status [--json]` | What is running, player counts, and what should be but isn't. |
| `cloud logs [server] [-f] [--tail N]` | Tail logs. Defaults to the proxy and 200 lines. |
| `cloud exec <server> "<cmd>"` | Console command via RCON. |
| `cloud restart <group> --rolling` | One instance at a time, waiting for each to be healthy. |
| `cloud down [--volumes]` | Stop. `--volumes` deletes worlds and asks twice. |
| `cloud add [preset]` | Add a community preset. No argument lists them. |
| `cloud ask "<request>"` | Propose a config change **as a diff**. Never applies it. |
| `cloud explain <server>` | Read the logs, say what broke. |

Ten commands. An eleventh is a design question first — which is why rotating
the forwarding secret is a flag on `apply` rather than a `cloud secret` of its
own. The new secret is useless until every backend restarts, and `apply` is
what restarts them.

## Configuration

```toml
[network]
name       = "mynetwork"
entry_port = 25565
forwarding = "modern"
online     = true

[proxy]
software = "velocity"
memory   = "512m"
ports    = ["19132:19132/udp"]   # extra published ports, e.g. Bedrock

[groups.lobby]
version  = "1.21.10"
memory   = "2G"
min      = 2          # two instances: lobby-1, lobby-2
fallback = true       # players land here
modrinth = ["luckperms:v5.5.71-bukkit"]   # pinned plugins, by slug:version
hangar   = ["ViaVersion:5.11.0"]

[groups.survival]
version  = "1.21.10"
memory   = "4G"
static   = true       # keeps its world across restarts
```

See [SPEC.md](SPEC.md) for the full format.

## Running more than one of something

```toml
[groups.lobby]
min      = 3          # lobby-1, lobby-2, lobby-3
fallback = true
```

All three are registered with the proxy and all three are in its failover
list, so a player whose lobby goes down is moved to a sibling instead of
being disconnected.

**This is failover, not load balancing.** Both proxies walk the list in order,
so everyone still *joins* on `lobby-1`; the others take over when it is
unavailable and hold the players it hands off. Spreading players evenly on join
needs a proxy plugin — there is no built-in balancer in Velocity or BungeeCord.

**Updating without an outage:**

```sh
cloud apply --rolling
```

Recreates one instance of a group at a time, waiting for each to report healthy
before touching the next:

```
  cycling lobby (3 instances)
    ✓ lobby-1 ready in 17s
    ✓ lobby-2 ready in 16s
    ✓ lobby-3 ready in 18s
```

It waits for Docker's healthcheck, not for a fixed number of seconds — a Paper
container is "running" one second after it starts and cannot accept a login for
another minute. If an instance fails to come back, the rollout stops there and
says so: the rest of the group keeps running the old version, so a bad update
costs you one instance instead of the whole group.

Two honest limits. The proxy is a single container, so recreating *it*
reconnects everybody — rolling protects backends only. And a group with
`min = 1` has nothing to fail over to, so restarting it is an outage however
slowly you do it; plain `cloud apply` warns before recreating a multi-instance
group all at once.

There is no autoscaling. Reacting to player counts needs a process watching
them, and this tool has no daemon — that is the constraint the whole design is
built on, not an oversight.

## Where the files are

Plugin files live on your machine, at the same path for every server,
whatever the storage mode:

```
mynetwork/
  cloud.toml
  data/
    proxy/plugins/            <- the proxy's plugins
    lobby/plugins/            <- open, edit, restart
      LuckPerms/config.yml
    survival/plugins/
  templates/
```

Edit a file, `cloud restart lobby`, done. The world is *not* here unless the
group is `static` with `storage = "bind"` — worlds are what makes a bind mount
slow on Docker Desktop, and a handful of YAML files is not. So the config you
want to edit is always reachable, and the directory that would make your server
stutter stays in the volume.

### Templates — one edit, every instance

A group running three lobbies has three plugin directories, and configuring it
by editing all three is not a plan. Point the group at a template instead:

```toml
[groups.lobby]
min      = 3
template = "hub"        # a directory under templates/
```

`templates/hub/` mirrors the server directory, so
`templates/hub/plugins/LuckPerms/config.yml` arrives as
`plugins/LuckPerms/config.yml` in every instance.

**The template owns those files.** It is copied over each instance on every
start, so the loop is: edit `templates/hub/`, `cloud restart lobby --rolling`,
all three are updated with no outage. Editing `data/lobby-1/plugins/...`
directly is pointless for a group that has a template — it is overwritten on
the next start. Files the template does not contain, including the world, are
left alone.

`cloud apply` creates `templates/<name>/` for you and warns if it is empty,
because seeding from an empty directory is a silent no-op.

## Extending it

Three surfaces, deliberately none of them a module system — an in-process
plugin API is exactly what left the older cloud systems unmaintainable.

**Presets** are pure config. `cloud add geyser` merges a fragment, shows a
diff, and waits for confirmation. The result is validated by the same schema as
a hand-written `cloud.toml`; a preset gets no privileges and cannot run code. A
preset may add plugins, environment, whole groups, and ports on the proxy — but
never a port on a backend, which CI asserts.

**Environment variables** are the entire server-side API. Every backend gets:

| | |
|---|---|
| `CLOUD_NETWORK` | network name |
| `CLOUD_GROUP` | group this server belongs to |
| `CLOUD_INSTANCE` | this server's name |
| `CLOUD_INSTANCE_INDEX` / `CLOUD_GROUP_SIZE` | position within the group |
| `CLOUD_FALLBACK` | where players land |
| `CLOUD_GROUPS` / `CLOUD_SERVERS` | everything on the network |
| `CLOUD_PROXY` | the proxy's container name |
| `CLOUD_STATIC` | whether this server keeps its world |

A Paper plugin reads `System.getenv("CLOUD_GROUP")`. There is no jar to ship,
no version to match, and nothing that can break on upgrade. Anything you set in
`[groups.x.env]` overrides these.

**Contributing a preset** is adding one entry to a registry file and opening a
PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Proxies other than Velocity

Velocity is the default and the better choice. BungeeCord and Waterfall are
supported for the case where a plugin you depend on has no Velocity build:

```toml
[proxy]
software = "bungeecord"      # or "waterfall"

[network]
forwarding = "bungeeguard"   # NOT "modern" — that is Velocity-only
```

Modern forwarding is a Velocity protocol. Asking for it on BungeeCord is
rejected at validation rather than at login time, where it looks identical to a
bad secret. The alternatives are `bungeeguard` (BungeeCord-style forwarding plus
a token the BungeeGuard plugin checks — `cloud apply` installs and configures it
on the proxy and every backend) and `legacy` (no token at all — safe only
because backends publish no port). `cloud apply` renders `proxy/config.yml` instead of `velocity.toml`, and
patches `spigot.yml` instead of Paper's Velocity section. See
[examples/bungeecord/](examples/bungeecord/).

`proxy.version` pins Velocity only; the BungeeCord and Waterfall images track
their own latest build.

## Modded servers

`software = "fabric"` and `software = "neoforge"` run mods behind the same
proxy. Each trusts the proxy through a mod — FabricProxy-Lite or
Proxy-Compatible-Forge — that `cloud apply` installs, pins and hands the
forwarding secret, so there is nothing to configure by hand. Fabric needs
Velocity's modern forwarding; NeoForge works with any mode. See
[examples/modded/](examples/modded/).

## Databases, Prometheus, anything else

No feature needed — `docker compose` already merges `docker-compose.override.yml`
with the generated file, so that is where anything this tool does not model
goes. Nothing reads or writes it; it is yours. Backups work the same way — a
tested [itzg/mc-backup recipe](docs/integrations.md#backups), restore included.

```yaml
# docker-compose.override.yml
services:
  db:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: network
      MARIADB_USER: minecraft
      MARIADB_PASSWORD: ${DB_PASSWORD:?set it in .env}
      MARIADB_RANDOM_ROOT_PASSWORD: "yes"
    volumes: [db-data:/var/lib/mysql]
    networks: [cloud]          # the network the servers are on

  prometheus:
    image: prom/prometheus
    volumes: [./prometheus.yml:/etc/prometheus/prometheus.yml:ro]
    networks: [cloud]
    ports: ["127.0.0.1:9090:9090"]   # localhost only — see below

volumes:
  db-data:
```

Everything on the `cloud` network reaches everything else **by service name,
with no published port**. A plugin connects to `db:3306`; Prometheus scrapes
`lobby-1:9225`. Point your plugins at it through the group's environment:

```toml
[groups.lobby.env]
DB_HOST = "db"
DB_PORT = "3306"
```

Verified end to end: a Paper server opens a TCP connection to a hand-added
container by name, and repeated `cloud apply` leaves that container running —
it is part of the merged project, so `--remove-orphans` does not touch it.

**One thing to be careful with.** An override can publish ports, which is the
one way to bypass the security model below. `cloud apply` reads the *merged*
config and warns:

```
warning db publishes 6379/tcp on every interface.
warning lobby publishes 25565/tcp, but it is a Minecraft server.
  Backends run online-mode=false and trust the proxy's word about who
  a player is. Anyone who can reach lobby directly can join it as any
  player, including an operator.
```

Binding to `127.0.0.1:` is silent — that is the safe way to reach a dashboard
from the machine itself.

## No backend ports

Every backend listens on 25565 inside its own network namespace and is reached
by container name over Docker's embedded DNS. There is no port allocator
because there are no host ports to allocate.

This is a security property, not just convenience. Backends run
`online-mode=false` — they trust whatever the proxy says about a player's
identity. If a backend were reachable from the internet, anyone could connect
directly and claim any UUID, including an operator's. Modern forwarding's MAC
signature is the second line of defence; not publishing the port is the first.

## AI providers

| Provider | Setup |
|---|---|
| none (default) | Works. `cloud init` uses prompts. |
| Anthropic | `export ANTHROPIC_API_KEY=...` |
| Ollama | `export CLOUD_AI_PROVIDER=ollama` — offline, no account, no cost |

`CLOUD_AI_MODEL` overrides the model. `CLOUD_AI_PROVIDER=none` disables the
layer entirely.

The AI never applies anything. `ask` prints a diff and stops; `apply` never
calls a model. Version strings are constrained to the live PaperMC API rather
than the model's memory. Logs passed to `explain` are treated as data to
summarise, never as instructions to follow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Templates and presets are the easiest
place to start.

## License

Apache-2.0. Includes an explicit patent grant, and no copyleft obligations for
people running modified copies.
