# Proxies

Velocity is the default and the better choice. BungeeCord and Waterfall are
supported for the case where a plugin you depend on has no Velocity build.

```toml
[proxy]
software = "bungeecord"      # or "waterfall", or "velocity"

[network]
forwarding = "bungeeguard"   # NOT "modern" — that is Velocity-only
```

## What differs

| | Velocity | BungeeCord / Waterfall |
|---|---|---|
| Generated config | `proxy/velocity.toml` | `proxy/config.yml` |
| Forwarding modes | `modern`, `bungeeguard`, `legacy` | `bungeeguard`, `legacy` |
| Forwarding switch | `player-info-forwarding-mode` | `ip_forward: true` |
| Backend switch | `proxies.velocity.enabled` | `spigot.yml` `settings.bungeecord` |
| Failover list | `try` | `listeners[].priorities` |
| Secret handling | built in | BungeeGuard plugin, installed by `cloud apply` |
| Version pinning | `proxy.version` | image tracks the latest build |

Exactly one config file is generated, chosen from `proxy.software`, and the
same choice decides what Compose mounts. A proxy given the wrong file starts
cleanly and then refuses every login, so the two can never disagree here.

Switching `proxy.software` leaves the previous file on disk. It is unused and
gitignored; delete it if it bothers you.

## Modern forwarding is Velocity-only

`forwarding = "modern"` with `software = "bungeecord"` is rejected at parse
time:

```
error cloud.toml is invalid:
  network.forwarding: forwarding = "modern" only exists in Velocity, but
  proxy.software is "bungeecord". Use forwarding = "bungeeguard"
  (recommended; cloud apply installs and configures BungeeGuard) or "legacy"
  (only safe if backends are unreachable from outside the Docker network).
```

BungeeCord has no implementation of modern forwarding. Without this check the
proxy would start, listen, and reject every login with "Unable to verify player
identity" — which looks exactly like a bad secret and is not one.

See [Forwarding](forwarding.md) for the mode table and the BungeeGuard setup.

## Version pinning

`proxy.version` pins Velocity only. The BungeeCord and Waterfall images track
their own latest build.

Do not set `version = "latest"` for Velocity: it currently resolves to a 4.x
snapshot, which is a development build and needs Java 25. The default is a
pinned stable 3.x release (3.5.1) for that reason. Velocity 4.x has stable
releases too; pin one explicitly, e.g. `version = "4.2.0"`, and the proxy
image moves to Java 25 on its own.

## Proxy plugins

```toml
[proxy]
plugins = ["https://.../LuckPerms-Velocity.jar"]
```

Direct download URLs, same as for a group. The proxy's plugin files land in
`./data/proxy/plugins/` on the host, where you can edit their configs.

Make sure the jar is the proxy build of the plugin — a Bukkit jar will not load
in Velocity, and vice versa. Presets get this right for you; see
[Presets](presets.md).
