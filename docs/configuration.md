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
| `version` | string | `"3.5.1"` | Pins Velocity only. Not `latest` — that resolves to a 4.x snapshot. |
| `java` | int | derived | Override the container's Java version. |
| `memory` | string | `"512m"` | Looks like `512M` or `4G`. |
| `memory_limit` | string | derived | Container memory cap. See [Memory](#memory). |
| `pin` | string | — | Image digest pin. See [Pinning images](#pinning-images). |
| `plugins` | string[] | `[]` | Direct download URLs. |
| `modrinth` | string[] | `[]` | `slug:version` — see [Plugins](#plugins). |
| `hangar` | string[] | `[]` | `slug:version` — see [Plugins](#plugins). |
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
| `software` | enum | `"paper"` | Also `folia`, `purpur`, `spigot`, and the mod loaders `fabric`, `neoforge` — see [Mod servers](#mod-servers-fabric-and-neoforge). |
| `version` | string | — | Required. Looks like `1.21.10`. |
| `memory` | string | `"2G"` | JVM heap. |
| `memory_limit` | string | derived | Container memory cap. See [Memory](#memory). |
| `pin` | string | — | Image digest pin. See [Pinning images](#pinning-images). |
| `java` | int | derived | Override the container's Java version. |
| `min` | int | `1` | How many instances to run. 0–50. |
| `fallback` | bool | `false` | Players land here. Exactly one group must set it. |
| `static` | bool | `false` | Own directory under `data/`, one instance only. |
| `template` | string | — | Directory under `templates/` — see [Server files](server-files.md). |
| `plugins` | string[] | `[]` | Direct download URLs. |
| `modrinth` | string[] | `[]` | `slug:version` — see [Plugins](#plugins). |
| `hangar` | string[] | `[]` | `slug:version` — see [Plugins](#plugins). |
| `env` | table | `{}` | Extra environment variables, merged last so they win. |

### Mod servers: Fabric and NeoForge

`software = "fabric"` and `software = "neoforge"` run mods instead of plugins.
Neither has Paper's built-in proxy support, so each trusts the proxy through a
mod that `cloud apply` installs and configures:

| | Fabric | NeoForge |
|---|---|---|
| Proxy mod | FabricProxy-Lite, pinned per Minecraft version | Proxy-Compatible-Forge, pinned |
| Forwarding | `modern` only | any |
| Secret reaches it through | the environment | its config, patched on every start |
| Minimum version | one FabricProxy-Lite supports (1.21+ built in) | 1.20.1 |

On both, `plugins` URLs are downloaded as mods, `modrinth` references resolve
their required dependencies, and `hangar` is rejected — Hangar serves Paper
plugins. The directory on the host is `data/<server>/config` instead of
`plugins`, since that is where mods keep their settings. Listing the proxy mod
yourself in `modrinth` replaces the pinned one. See
[examples/modded/](https://github.com/muckmuckhub/cloud/tree/main/examples/modded).

### Plugins

Three ways to name a plugin, on groups and on the proxy alike:

```toml
[groups.lobby]
plugins  = ["https://example.com/SomePlugin-1.2.jar"]   # a direct URL
modrinth = ["luckperms:v5.5.71-bukkit"]                  # Modrinth slug:version
hangar   = ["ViaVersion:5.11.0"]                         # Hangar slug:version
```

A reference must carry a version. An unpinned one would resolve to whatever is
newest at every container start, which is how `/latest/` URLs turned into
crash-looping servers. Modrinth lists versions at
`https://modrinth.com/plugin/<slug>/versions` — use the *version number* shown
there, which for some projects is per platform (`v5.5.71-bukkit`,
`v5.5.71-velocity`). Hangar slugs are case-sensitive.

Hangar references are turned into download URLs when rendering, using the
`PAPER` platform on backends and `VELOCITY` or `WATERFALL` on the proxy.
Modrinth references are resolved by the server image at start, along with any
dependencies the plugin declares as required.

### Memory

`memory` is the JVM heap. A JVM uses more than its heap — metaspace, threads,
the JIT, network buffers — so each container is capped at the heap plus a
quarter, and at least 512M more: `512m` gets `1024m`, `2G` gets `2560m`,
`4G` gets `5120m`. Without a cap, one leaking server can take the host down
with everything else on it.

Set `memory_limit` when a plugin needs a lot of memory outside the heap (map
renderers are the usual ones). It must be larger than `memory`. A container
that hits its cap is killed and restarted by Docker — see
[Troubleshooting](troubleshooting.md#it-restarts-with-exit-code-137).

### Pinning images

Images are derived: `itzg/minecraft-server:java21` for a 1.21 group. That tag
moves whenever the image is rebuilt, so the same `cloud.toml` can run a
different image next month. To freeze it, pin the digest:

```toml
[groups.lobby]
version = "1.21.10"
pin     = "java21@sha256:7dd4e72e6daf7c98aedf39fd9c9744b4036dee0d9a8b49db4009919b5d2ea89d"
```

Get the current digest for a tag with:

```sh
docker buildx imagetools inspect itzg/minecraft-server:java21 --format "{{json .Manifest.Digest}}"
docker buildx imagetools inspect itzg/mc-proxy:java21 --format "{{json .Manifest.Digest}}"
```

The pin names its tag on purpose. With a digest, Docker ignores the tag, so a
bare digest would keep running the Java 21 image after you moved `version` to
a Minecraft release that needs Java 25. Validation compares the pinned tag
with the one the config derives and refuses a mismatch — update the pin
together with `version` or `java`. Pins are optional; most networks do not
need one.

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
6. `memory_limit`, where set, is larger than `memory`.
7. `modrinth` and `hangar` entries are `slug:version` with a version.
8. A `pin` names the Java tag the config derives (`java21@sha256:…`).
9. `fabric` needs `forwarding = "modern"`; `neoforge` needs Minecraft 1.20.1+;
   neither can use `hangar`.

Validation failures print every problem with its path and exit without touching
Docker:

<video src="assets/demos/validate.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud apply rejecting an invalid cloud.toml"></video>

```
error cloud.toml is invalid:
  groups: exactly one group must set fallback = true (players need somewhere to land)
  groups.smp.min: a static group keeps its own world, so it cannot have more than one instance
```

## Derived, never configured

These are computed, and putting them in `cloud.toml` is not possible:

- Backend ports. Every backend listens on 25565 in its own network namespace.
- Docker image names and Java versions, derived from `software` + `version`.
  A `pin` can freeze the digest, but not choose a different image.
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
Velocity currently resolves to a 4.x snapshot, which is why the default is a
pinned stable 3.x release instead.
