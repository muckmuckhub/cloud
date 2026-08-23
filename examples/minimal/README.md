# Minimal example — Velocity + 2 Paper backends

The reference topology. `docker-compose.yml`, `proxy/velocity.toml` and
`proxy/patches/` in this directory are exactly what `cloud apply` generates
from the `cloud.toml` beside them — regenerate them any time with `cloud apply`.

```
internet ──▶ :25565 ──▶ velocity ──┬──▶ lobby:25565
                                   └──▶ survival:25565
```

## Run it

```sh
cloud apply          # generates the secret and every file below, then starts
```

Or, without the CLI:

```sh
cp .env.example .env
printf '%s' "$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')" > proxy/forwarding.secret
echo "FORWARDING_SECRET=$(cat proxy/forwarding.secret)" >> .env
docker compose up -d
docker compose logs -f proxy
```

Note the `printf` rather than `echo` — a trailing newline in that file is the
single most common cause of a broken handshake.

Connect to `localhost:25565`. You land on `lobby`. `/server survival` moves you.

## Where the plugin files are

```
data/proxy/plugins/       the proxy's plugins
data/lobby/plugins/       edit, then `cloud restart lobby`
```

Every server's plugin directory is on the host, whatever `storage` says. Worlds
are not — those follow `storage`, because a world is what makes a bind mount
slow on Docker Desktop. To put files in place before a server first boots, set
`template` on the group and mirror the server directory under `templates/`.

## Why there are no backend ports

Each container has its own network namespace, so every backend can listen on
25565 without colliding. Velocity reaches them by container name via Docker's
embedded DNS.

This is not just convenience. Backends run `online-mode=false` — they trust
whatever the proxy tells them about a player's identity. If a backend were
reachable from the internet, anyone could connect directly and claim any UUID,
including an admin's. Modern forwarding's MAC signature is the second line of
defence; not publishing the port is the first.

## The three files that must agree

This is where every Velocity setup breaks. All three come from one generated
secret:

| File | Setting | Value |
|---|---|---|
| `proxy/velocity.toml` | `player-info-forwarding-mode` | `"modern"` |
| `proxy/forwarding.secret` | (file contents) | the secret, **no trailing newline** |
| `paper-global.yml` (patched) | `proxies.velocity.secret` | the same secret |
| `paper-global.yml` (patched) | `proxies.velocity.online-mode` | must match `online-mode` in `velocity.toml` |
| `server.properties` | `online-mode` | `false` |
| `spigot.yml` | `settings.bungeecord` | `false` |

Note the trap in rows 4 and 5: `online-mode` is `true` in `paper-global.yml`
and `false` in `server.properties`. They mean different things. The first says
"the proxy authenticated this player"; the second says "don't authenticate them
yourself". Setting both the same breaks skins or breaks login.

`bungeecord: false` in `spigot.yml` matters because legacy BungeeCord forwarding
and modern forwarding conflict — enabling both silently produces broken UUIDs.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Unable to verify player identity` | Secret mismatch. Usually a trailing newline in `forwarding.secret`. Re-run `cloud apply` after deleting `proxy/forwarding.secret` and restart everything. |
| `This server requires you to connect with Velocity` | Backend has forwarding on, proxy doesn't. Check `player-info-forwarding-mode` in `velocity.toml`. |
| Skins missing, UUIDs offline-format | `proxies.velocity.online-mode` is `false`. Set it `true`. |
| `Unable to connect you to lobby` | Backend still starting. Watch `cloud logs lobby` — Paper's first boot generates a world and takes a minute. |
| Backend logs `If you wish to use IP forwarding...` | Secret mismatch again, or `bungeecord: true` left in `spigot.yml`. |

After changing the secret, **every** backend needs a restart. Paper reads
`paper-global.yml` once at boot — which is what `cloud apply --rotate-secret`
does for you: new secret, both copies rewritten together, every container
recreated in the same reconcile.

## Verify the isolation

```sh
# Should succeed:
docker compose exec proxy sh -c 'getent hosts lobby'

# Should fail — backends are not published:
nc -zv localhost 25566
```
