# Config format specification

**Version 1.**

Changelog: `network.storage`, `proxy.ports` and `proxy.env` added in tool
0.1.0. After 0.1.0: `memory_limit`, `modrinth`, `hangar` and `pin` added to
`[proxy]` and `[groups.<name>]`, and `fabric` and `neoforge` to
`groups.<name>.software` (additive and optional); the `proxy.version`
default moved from `3.4.0-SNAPSHOT` to the stable `3.5.1`; `forwarding =
"none"` dropped from the enum (it never validated). Spec version unchanged.

This document is versioned separately from the tool. It exists so that the
compatibility promise is a written contract rather than an implementation
detail that shifts when someone refactors.

## Compatibility promise

- Within a major version, a valid `cloud.toml` keeps working. New optional
  fields may be added; existing fields never change meaning or get removed.
- Breaking changes bump the spec version. The tool reads both the current and
  the previous version for at least one full major release.
- Generated files (`docker-compose.yml`, `proxy/velocity.toml` or
  `proxy/config.yml`, `proxy/patches/*`) are **not** covered. They are derived artifacts, marked
  `GENERATED`, and may change shape at any time. Do not depend on them; depend
  on `cloud.toml`.

## `[network]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | Required. `^[a-z][a-z0-9-]*$`, max 32. Prefixes container names. |
| `entry_port` | int | `25565` | The single host port published. 1–65535. |
| `motd` | string | `"A Velocity Server"` | Shown in the server list. |
| `forwarding` | enum | `"modern"` | `modern` \| `legacy` \| `bungeeguard` |
| `online` | bool | `true` | Whether the proxy authenticates against Mojang. |
| `domain` | string | — | Optional. Used only to print DNS instructions. |
| `storage` | enum | `"bind"` | `bind` \| `volume`. Where static groups keep their data. |

`storage = "bind"` puts persistent data in `./data/<server>`. `storage =
"volume"` uses a Docker named volume, which avoids the host-to-VM filesystem
bridge on Docker Desktop and is substantially faster on Windows and macOS.

This is a config field rather than a platform check on purpose: rendering must
stay a pure function of `cloud.toml`, so the same file produces identical
output on every machine. `cloud init` merely picks a good default per platform
and writes it down.

`forwarding = "none"` is rejected by validation. It gives every player an
offline-mode UUID and leaves backends unauthenticated.

### Forwarding modes

| Mode | Proxies | Secret | Backend wiring | Extra setup |
|---|---|---|---|---|
| `modern` | Velocity only | yes | `proxies.velocity.*` in `paper-global.yml` | none |
| `bungeeguard` | any | yes (a token) | `settings.bungeecord: true` | none — BungeeGuard is installed and configured by `cloud apply` |
| `legacy` | any | no | `settings.bungeecord: true` | none |
| `none` | — | — | — | rejected |

`modern` on a non-Velocity proxy is a validation error. BungeeCord has no
implementation of it, so the proxy starts, listens, and rejects every login
with "Unable to verify player identity" — indistinguishable from a bad secret.
Failing at parse time rather than at login time is the whole point of catching
it here.

Under `bungeeguard` the token is the forwarding secret. A pinned BungeeGuard is
added to every backend's plugins, and to the proxy unless it is Velocity, which
implements the mode itself. Each backend's `plugins/BungeeGuard/config.yml` is
seeded by `apply` when absent and has `allowed-tokens` replaced with the secret
on every start; a BungeeCord proxy gets it in `plugins/BungeeGuard/token.yml`,
rewritten by every `apply`. A user-listed plugin URL ending in
`BungeeGuard.jar` replaces the pinned one.

Whatever the mode, `server.properties` gets `online-mode=false` and exactly one
of the Velocity or BungeeCord backend switches is on. Both on, or both off,
breaks login or skins respectively.

## `[proxy]`

| Key | Type | Default |
|---|---|---|
| `software` | enum | `"velocity"` — also `bungeecord`, `waterfall` |
| `version` | string | `"3.5.1"` | Not `latest` — that resolves to a 4.x snapshot. Pins Velocity only. |
| `java` | int | derived | Override the container's Java version. |
| `memory` | string | `"512m"` — `^\d+[MmGg]$` |
| `memory_limit` | string | derived — container cap, must exceed `memory` |
| `pin` | string | — `java<N>@sha256:<digest>`, tag must match the derived one |
| `plugins` | string[] | `[]` — direct download URLs |
| `modrinth` | string[] | `[]` — Modrinth `slug:version`, version required |
| `hangar` | string[] | `[]` — Hangar `slug:version`, rendered for `VELOCITY` or `WATERFALL` |
| `ports` | string[] | `[]` — extra published ports, Compose short syntax |
| `env` | table | `{}` — extra container environment variables |

`ports` entries look like `19132`, `19132:19132` or `19132:19132/udp`. Host IPs
are not accepted: binding to one interface is a deployment concern, and
rendering must not depend on the machine. Validation rejects a mapping whose
host port is `network.entry_port` on TCP, and two mappings on the same host
port and protocol. The same number on `/tcp` and `/udp` is allowed, because
Docker binds those independently.

The proxy is the only service that may publish a port. There is no group
equivalent of `ports`, and there will not be one — see "No backend ports" in
the README.

`env` is merged last, so it overrides anything the renderer derived.

## `[groups.<name>]`

`<name>` must match `^[a-z][a-z0-9-]*$`.

| Key | Type | Default | Notes |
|---|---|---|---|
| `software` | enum | `"paper"` — also `folia`, `purpur`, `spigot`, `fabric`, `neoforge` |
| `version` | string | — | Required. `^\d+\.\d+(\.\d+)?$` |
| `memory` | string | `"2G"` | JVM heap. |
| `memory_limit` | string | derived | Container cap: heap + max(heap/4, 512M). Must exceed `memory`. |
| `pin` | string | — | Image digest pin, `java<N>@sha256:<digest>`. The tag must be the one derived from `version`/`java`. |
| `java` | int | derived | Override the container's Java version. |
| `min` | int | `1` | Instances to keep running. 0–50. |
| `fallback` | bool | `false` | Players land here. Exactly one group must set it. |
| `static` | bool | `false` | Own directory under `data/` instead of a volume; one instance only. |
| `template` | string | — | Directory under `templates/` to seed from. See "Server files". |
| `plugins` | string[] | `[]` | Direct download URLs. |
| `modrinth` | string[] | `[]` | Modrinth `slug:version`. Resolved by the image at start, with required dependencies. |
| `hangar` | string[] | `[]` | Hangar `slug:version`. Rendered to a download URL for the `PAPER` platform. |
| `env` | table | `{}` | Extra container environment variables. |

`modrinth` and `hangar` entries must carry a version. An unpinned reference
would resolve to the newest release at every container start — the same drift
that made `/latest/` URLs serve an HTML page instead of a jar.

### Cross-field rules

1. Exactly one group has `fallback = true`.
2. The fallback group has `min >= 1`.
3. A `static` group cannot have `min > 1` — it owns a single world directory.
4. `forwarding = "modern"` requires `proxy.software = "velocity"`.
5. No entry in `proxy.ports` may republish `network.entry_port` on TCP, or
   collide with another entry on the same host port and protocol.
6. `memory_limit`, where set on the proxy or a group, is larger than `memory`.
7. A `pin`, where set, names the Java tag derived for that service.
8. A `fabric` group requires `forwarding = "modern"`, and a Minecraft version
   with a known FabricProxy-Lite release unless it lists `fabricproxy-lite`
   in `modrinth` itself.
9. A `neoforge` group requires Minecraft 1.20.1 or newer.
10. `fabric` and `neoforge` groups cannot use `hangar`.

`static` does **not** mean "persistent as opposed to disposable": every group
keeps its data across restarts, in a named volume by default. `static` chooses
where that data lives (`./data/<name>` under `storage = "bind"`, browsable and
easy to back up) and limits the group to one instance. There is no ephemeral
group kind; instances are rebuilt from their template, not discarded.

### Failover and rolling updates

Every instance of the fallback group is written into the proxy's failover list
(`try` for Velocity, `priorities` for BungeeCord), not just the first. Both are
ordered lists: players join on the first entry and are moved to the next
reachable one when a backend dies under them. With a single entry, restarting
that entry disconnects the players the list exists to catch.

This is failover, not load balancing. Neither proxy has a built-in balancer;
spreading players on join requires a proxy plugin.

`cloud apply --rolling` recreates the instances of each group with `min > 1`
one at a time, waiting for each to report healthy before the next. It waits on
Docker's healthcheck rather than a fixed delay, and stops at the first instance
that fails to come back, leaving the rest of the group on the previous version.

Not covered by a rolling update:

- The proxy. There is one, and recreating it reconnects every player.
- Groups with `min = 1`. Nothing can catch their players.

There is no autoscaling: instance counts change only when `cloud.toml` changes.
Reacting to player counts would require a long-running process, and this tool
has no daemon.

### Instance naming

`min = 1` yields one container named after the group (`lobby`). `min > 1`
yields `lobby-1`, `lobby-2`, … Both are registered with the proxy by name.

## Java versions

Derived from the software version, overridable with `java`:

| Minecraft | Java | Class file |
|---|---|---|
| 1.16 and older | 8 | 52 |
| 1.17 | 16 | 60 |
| 1.18–1.20 | 17 | 61 |
| 1.21.x | 21 | 65 |
| 26.1+ | 25 | 69 |

Velocity 3.x runs on Java 21; Velocity 4.x requires Java 25. `version =
"latest"` currently resolves to a 4.x snapshot, so it implies Java 25 — which
is why the default is a pinned 3.x release rather than `latest`.

An `UnsupportedClassVersionError` reports class file numbers, not Java
versions. Use the table above to translate before changing anything.

## Derived, never configured

These are computed and must not appear in `cloud.toml`:

- Backend ports. All backends bind 25565 in their own namespace.
- Docker image names and Java versions — derived from `software` + `version`.
  `pin` freezes the digest of the derived tag; it cannot select another image.
- `online-mode` on backends — always `false`; the proxy authenticates.
- `proxies.velocity.online-mode` in Paper — mirrors `network.online`.
- `settings.bungeecord` in `spigot.yml` — derived from the forwarding mode:
  `false` under `modern`, `true` under `legacy` and `bungeeguard`.
- Which proxy config file is written — derived from `proxy.software`.
- Where plugin files are bind-mounted — always `./data/<server>/plugins`.
- The forwarding secret — generated locally, never in `cloud.toml`.

## Server files

Every server's plugin directory is bind-mounted to `./data/<server>/plugins`,
including the proxy's (`./data/proxy/plugins`). This is not affected by
`network.storage`: a named volume cannot be opened from the host, and plugin
configs are the files people actually need to edit.

`storage` still decides where the *world* lives, which is the part that is slow
across the Docker Desktop filesystem bridge. A `static` group with
`storage = "bind"` already has all of `/data` on the host, so it gets no
separate plugins mount.

`cloud apply` creates these directories before calling Compose. Docker would
otherwise create them as root, leaving a directory you cannot edit without
sudo, which defeats the purpose.

### Templates

`template = "hub"` mounts `templates/hub/` read-only at `/config` and sets
`COPY_CONFIG_DEST=/data`, so the template mirrors the server directory:
`templates/hub/plugins/Foo/config.yml` becomes `plugins/Foo/config.yml`.

**A template is authoritative.** `SYNC_SKIP_NEWER_IN_DESTINATION=false` is set
with it, so its files are copied over every instance of the group on every
start. One edit in `templates/hub/` therefore reaches all of them, which is the
only sane way to configure a group running several instances. Files the
template does not contain — the world, logs, plugin databases — are untouched.

The consequence to know: for a group with a template, editing the live copies
under `data/<server>/` does nothing lasting. Groups without a template are
unaffected and their live files are yours to edit. Set
`SYNC_SKIP_NEWER_IN_DESTINATION = "true"` in `[groups.<name>.env]` to get
seed-once behaviour instead.

`cloud apply` creates `templates/<name>/` before calling Compose, for the same
reason it creates the data directories, and warns when one is empty — seeding
from an empty directory is a no-op that otherwise reports nothing.

Earlier versions mounted templates at `/template`, which the image has never
read, and set the skip flag the other way, which made a template a one-shot
seed. Both failed silently.

## The proxy config file

Velocity reads `proxy/velocity.toml`. BungeeCord and Waterfall read
`proxy/config.yml`. Exactly one is generated, chosen from `proxy.software`, and
the same choice decides what Compose mounts — a proxy given the wrong file
starts cleanly and refuses every login.

Switching `proxy.software` leaves the previous file on disk. It is unused and
gitignored; delete it if it bothers you.

## Patch definitions

`proxy/patches/` is mounted at `/patches` and referenced by
`PATCH_DEFINITIONS`. Every file in that directory is **one patch set**, whose
only valid top-level keys are `file`, `ops` and `file-format`. There is no
array wrapper — a `{"patches": [...]}` shape is rejected at container start
with "unrecognized field patches". One target file means one definition file.

## The forwarding secret

Written to `proxy/forwarding.secret`, mode `0600`, **without a trailing
newline**, and mirrored into `.env` as `FORWARDING_SECRET` from the same
variable in the same operation.

A trailing byte here produces `Unable to verify player identity` with nothing
useful in the logs. Any reimplementation must preserve this.

Both files are gitignored.

Rotate with `cloud apply --rotate-secret`. Rotation requires restarting every
backend, since Paper reads `paper-global.yml` once at boot — which is why it is
a flag on `apply` rather than a command of its own. The new value reaches
containers through `.env` interpolation, so Compose sees changed environment
and recreates them as part of the same reconcile.

If the file cannot be made owner-only, `cloud apply` warns and continues. It
does not abort: the file is already written by then, and a warning you can act
on beats a half-applied network.

## Compose overrides

`docker-compose.override.yml` (or `compose.override.yaml`, and the other two
names Compose accepts) is merged by Docker Compose itself. This tool never
reads, writes or validates it, and it is the supported way to add services the
schema does not model — a database, a metrics stack, a web map.

Services on the `cloud` network resolve each other by service name over
Docker's embedded DNS. No published port is involved, and none should be:
`cloud apply` reads the merged configuration and warns when a service other
than the proxy publishes a port on every interface, more loudly when that
service is one of the Minecraft backends. Binding to a specific host address
such as `127.0.0.1` is not warned about.

Overridden services are part of the same Compose project, so `up -d
--remove-orphans` leaves them running and `cloud down` stops them with
everything else.

## Errors

Validation failures print every issue with its path, and exit 1 without
touching Docker. Rendering happens before reconciliation, so a bad config
cannot leave a half-applied network.
