# Configuration

`cloud.toml` is the only file you edit. Everything else is generated from it,
and the format is versioned — `SPEC.md` in the repository holds the
compatibility promise.

```toml
[network]
name       = "mynetwork"
entry_port = 25565
motd       = "A Minecraft Network"
forwarding = "modern"
online     = true

[proxy]
software = "velocity"
memory   = "512m"

[groups.lobby]
version  = "1.21.10"
memory   = "2G"
min      = 3
fallback = true

[groups.survival]
version = "1.21.10"
memory  = "4G"
static  = true
```

## `[network]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | Required. Lowercase, digits, dashes; max 32. Prefixes container names. |
| `entry_port` | int | `25565` | The single host port players connect to. |
| `motd` | string | `"A Velocity Server"` | Shown in the server list. |
| `forwarding` | enum | `"modern"` | See [Forwarding](forwarding.md). |
| `online` | bool | `true` | Whether the proxy authenticates against Mojang. |
| `domain` | string | — | Optional. Only used to print DNS instructions. |
| `storage` | enum | `"bind"` | `bind` or `volume`. Where static groups keep their data. |

`storage = "bind"` puts a static group's data in `./data/<server>/`, where you
can browse it. `storage = "volume"` uses a Docker named volume, which is
substantially faster on Windows and macOS because it never crosses the
host-to-VM filesystem bridge. `cloud init` picks `volume` on those platforms
and writes the choice into `cloud.toml`, so the same file still produces
identical output on every machine.

Plugin files are on the host either way — see [Server files](server-files.md).

## `[proxy]`

| Key | Type | Default | Notes |
|---|---|---|---|
| `software` | enum | `"velocity"` | Also `bungeecord`, `waterfall`. See [Proxies](proxies.md). |
| `version` | string | `"3.4.0-SNAPSHOT"` | Pins Velocity only. Not `latest` — that resolves to a 4.x snapshot. |
| `java` | int | derived | Override the container's Java version. |
| `memory` | string | `"512m"` | Looks like `512M` or `4G`. |
| `plugins` | string[] | `[]` | Direct download URLs. |
| `ports` | string[] | `[]` | Extra published ports, e.g. `"19132:19132/udp"`. |
| `env` | table | `{}` | Extra environment variables for the proxy container. |

`ports` accepts Compose short syntax: `19132`, `19132:19132`,
`19132:19132/udp`. Host IPs are rejected — binding to one interface is a
deployment concern, and rendering must not depend on the machine. Validation
also rejects a mapping that republishes `entry_port` on TCP.

The proxy is the only service that may publish a port. There is no group
equivalent, and that is deliberate: see [Forwarding](forwarding.md).

## `[groups.<name>]`

Each group becomes one or more containers. The name must be lowercase letters,
digits and dashes, starting with a letter.

| Key | Type | Default | Notes |
|---|---|---|---|
| `software` | enum | `"paper"` | Also `folia`, `purpur`, `spigot`. |
| `version` | string | — | Required. Looks like `1.21.10`. |
| `memory` | string | `"2G"` | JVM heap. |
| `java` | int | derived | Override the container's Java version. |
| `min` | int | `1` | How many instances to run. 0–50. |
| `fallback` | bool | `false` | Players land here. Exactly one group must set it. |
| `static` | bool | `false` | Own directory under `data/`, one instance only. |
| `template` | string | — | Directory under `templates/` — see [Server files](server-files.md). |
| `plugins` | string[] | `[]` | Direct download URLs. |
| `env` | table | `{}` | Extra environment variables, merged last so they win. |

### `static` does not mean "persistent"

Every group keeps its data across restarts. `static` chooses *where* that data
lives — `./data/<name>` under `storage = "bind"`, easy to browse and back up —
and limits the group to a single instance. Use it for survival and SMP.

There is no ephemeral group kind. Instances are rebuilt from their template,
not discarded.

### Instance naming

`min = 1` gives one container named after the group (`lobby`). `min > 1` gives
`lobby-1`, `lobby-2`, … Both are registered with the proxy by name.

### Rules the schema enforces

1. Exactly one group has `fallback = true`.
2. The fallback group has `min >= 1`.
3. A `static` group cannot have `min > 1` — it owns a single world directory.
4. `forwarding = "modern"` requires `proxy.software = "velocity"`.
5. No entry in `proxy.ports` may republish `entry_port` on TCP, or collide with
   another entry on the same host port and protocol.

Validation failures print every problem with its path and exit without touching
Docker:

```
error cloud.toml is invalid:
  groups: exactly one group must set fallback = true (players need somewhere to land)
  groups.smp.min: a static group keeps its own world, so it cannot have more than one instance
```

## Derived, never configured

These are computed, and putting them in `cloud.toml` is not possible:

- Backend ports. Every backend listens on 25565 in its own network namespace.
- Docker image names and Java versions, derived from `software` + `version`.
- `online-mode` on backends — always `false`; the proxy authenticates.
- The forwarding secret — generated locally, never in `cloud.toml`.

## Java versions

Derived from the version, overridable with `java`:

| Minecraft | Java | Class file |
|---|---|---|
| 1.16 and older | 8 | 52 |
| 1.17 | 16 | 60 |
| 1.18–1.20 | 17 | 61 |
| 1.21.x | 21 | 65 |
| 26.1+ | 25 | 69 |

`UnsupportedClassVersionError` reports the *class file* number, not the Java
version. Use the table above to translate before changing anything.

Velocity 3.x runs on Java 21; Velocity 4.x needs 25. `version = "latest"` for
Velocity currently resolves to a 4.0.0 snapshot, which is why the default is a
pinned 3.x release instead.
