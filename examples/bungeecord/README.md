# BungeeCord example — BungeeGuard forwarding

For the case where a plugin you depend on has no Velocity build. Velocity is
the better default; this exists so the alternative is a supported path rather
than a half-rendered one.

`docker-compose.yml`, `proxy/config.yml` and `proxy/patches/` in this directory
are exactly what `cloud apply` generates from the `cloud.toml` beside them.

```
internet ──▶ :25565 ──▶ bungeecord ──┬──▶ lobby-1:25565
                                     ├──▶ lobby-2:25565
                                     └──▶ survival:25565
```

## What is different from the Velocity example

| | Velocity | BungeeCord / Waterfall |
|---|---|---|
| Proxy config | `proxy/velocity.toml` | `proxy/config.yml` |
| Forwarding | `modern` | `bungeeguard` or `legacy` |
| Forwarding switch | `player-info-forwarding-mode` | `ip_forward: true` |
| Backend switch | `proxies.velocity.enabled` | `spigot.yml` `settings.bungeecord` |
| Secret handling | built in | BungeeGuard plugin, installed by `cloud apply` |

`forwarding = "modern"` here is a validation error, not a runtime surprise.
Modern forwarding is a Velocity protocol; BungeeCord would start, listen, and
reject every login with `Unable to verify player identity` — which looks
exactly like a bad secret and is not one.

## BungeeGuard

Nothing to do by hand. For `forwarding = "bungeeguard"`, `cloud apply`:

- installs a pinned BungeeGuard on the proxy and on every backend,
- writes the forwarding secret to `data/proxy/plugins/BungeeGuard/token.yml`,
- seeds each backend's `plugins/BungeeGuard/config.yml` before its first boot,
  and sets its `allowed-tokens` to the same secret on every start.

`cloud apply --rotate-secret` updates all of them and restarts the proxy and
the backends together. The rest of BungeeGuard's config — its kick messages —
is yours; see the template below.

Choosing `forwarding = "legacy"` instead skips all of that and needs no plugin.
It is safe only because backends publish no port — anyone who *could* reach a
backend directly could claim any UUID, including an operator's.

## Templates

`templates/lobby/` in this directory is copied over **both** lobby instances on
every start, so one edit there configures the whole group:

```
templates/lobby/
  server.properties                     -> /data/server.properties
  plugins/BungeeGuard/config.yml        -> /data/plugins/BungeeGuard/config.yml
```

```sh
vim templates/lobby/plugins/BungeeGuard/config.yml   # messages; the token is set for you
cloud restart lobby --rolling      # both instances pick it up, no outage
```

The template owns those files: the copies under `data/lobby-1/` are overwritten
on the next start. Anything the template does not contain — the world, logs,
plugin databases — is left alone.

## Where the plugin files are

```
data/proxy/plugins/       the proxy's plugins
data/lobby/plugins/       edit, then `cloud restart lobby`
```

Every server's plugin directory is on the host, whatever `storage` says. Worlds
are not — those follow `storage`, because a world is what makes a bind mount
slow on Docker Desktop. To put files in place before a server first boots, set
`template` on the group and mirror the server directory under `templates/`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Unable to verify player identity` | You asked for `modern` on BungeeCord, or a BungeeGuard token mismatch. |
| Everyone shares one offline UUID | `ip_forward` is off, or `settings.bungeecord` is `false` on the backend. |
| `Not authenticated with Minecraft.net` | `online_mode` is `false` on the proxy while clients are online-mode. |
| Skins missing | Under BungeeCord forwarding this is expected without a skin plugin; modern forwarding on Velocity handles it natively. |
