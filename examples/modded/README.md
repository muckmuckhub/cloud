# Modded example — Fabric and NeoForge behind Velocity

A Paper lobby, a Fabric survival server and a NeoForge server behind one
Velocity proxy. `docker-compose.yml` and `proxy/` in this directory are exactly
what `cloud apply` generates from the `cloud.toml` beside them.

```
internet ──▶ :25565 ──▶ velocity ──┬──▶ lobby     (paper)
                                   ├──▶ survival  (fabric)
                                   └──▶ create    (neoforge)
```

## What is different from a Paper server

| | Paper | Fabric | NeoForge |
|---|---|---|---|
| Runs | plugins | mods | mods |
| Trusts the proxy via | built-in, patched into `paper-global.yml` | FabricProxy-Lite, via environment | Proxy-Compatible-Forge, patched into its config |
| Forwarding modes | all | `modern` only | all |
| `plugins = [...]` URLs go to | `/data/plugins` | `/data/mods` | `/data/mods` |
| `hangar` | yes | no — Hangar serves Paper plugins | no |
| Host-editable directory | `data/<server>/plugins` | `data/<server>/config` | `data/<server>/config` |
| Minimum version | — | whatever FabricProxy-Lite supports | 1.20.1 |

### Fabric

For every Fabric group `cloud apply`:

- installs FabricProxy-Lite, pinned to the release for that Minecraft version,
  and Fabric API, which it declares as a required dependency;
- passes the forwarding secret as `FABRIC_PROXY_SECRET`, so there is no config
  file to edit and a rotation reaches it like every other server;
- turns on FabricProxy-Lite's `hackMessageChain` (players switching servers
  were otherwise kicked for an invalid chat signature) and `hackEarlySend`
  (mods such as LuckPerms need the UUID during login).

To pin a different FabricProxy-Lite, list it yourself —
`modrinth = ["fabricproxy-lite:v2.11.0"]` — and the built-in one steps aside.
That is also the way forward for a Minecraft version the built-in table does
not know yet; validation says so when it happens.

### NeoForge

For every NeoForge group `cloud apply`:

- installs Proxy-Compatible-Forge, pinned;
- seeds `data/<server>/config/proxy-compatible-forge.toml` before the first
  boot, and patches `[forwarding]` `enabled`, `mode` and `secret` into it on
  every start — the mod has no environment variables, and without the seed the
  first boot would run on an empty secret and reject everyone.

The rest of that file is yours. List `proxy-compatible-forge:<version>` in
`modrinth` to replace the pinned release.

## Presets

`cloud add` presets that install plugins on "every group" skip mod servers: a
Bukkit jar in a Fabric or NeoForge server is never loaded. Presets that only
set environment variables still apply.
