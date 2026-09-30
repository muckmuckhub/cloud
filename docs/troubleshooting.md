# Troubleshooting

Start here:

```sh
cloud status                 # what is running, and what should be
cloud logs <server>          # the last 200 lines
cloud explain <server>       # if you have an AI provider configured
```

## Players cannot join

### `Unable to verify player identity`

The forwarding handshake failed. In order of likelihood:

1. **A trailing newline in `proxy/forwarding.secret`.** This is the classic.
   `cloud` writes the file without one; an editor may have added it. Delete the
   file and run `cloud apply` to regenerate, then restart everything.
2. **The secret changed but backends were not restarted.** Paper reads
   `paper-global.yml` once, at boot. `cloud apply --rotate-secret` handles the
   restart for you.
3. **`forwarding = "modern"` on BungeeCord.** Rejected at parse time now, but a
   config from an older version may still have it. Modern forwarding does not
   exist outside Velocity — use `bungeeguard`.

### `This server requires you to connect with Velocity`

The backend has forwarding enabled and the proxy does not, or the proxy is
sending a different style. Check that `network.forwarding` matches what the
proxy config says, and re-run `cloud apply`.

### `Not authenticated with Minecraft.net`

`online = false` on the proxy while clients are in online mode.

### Everyone shares one offline-mode UUID

Forwarding is off. Under BungeeCord that is `ip_forward`; under Velocity it is
`player-info-forwarding-mode`. Both are generated, so this usually means a
generated file was hand-edited — they are overwritten on the next apply.

## Skins are missing

`proxies.velocity.online-mode` is `false` in `paper-global.yml`. It mirrors
`network.online`, so set `online = true` in `[network]` and apply.

Under BungeeCord-style forwarding, missing skins are expected without a skin
plugin; modern forwarding on Velocity handles it natively.

## A server will not start

### `UnsupportedClassVersionError`

The number in the message is a **class file** version, not a Java version:

| Class file | Java |
|---|---|
| 52 | 8 |
| 55 | 11 |
| 61 | 17 |
| 65 | 21 |
| 69 | 25 |

A plugin built for a newer Java than the image provides is the usual cause.
Override it on the group:

```toml
[groups.lobby]
java = 25
```

### It crash-loops right after `Downloaded ...`

Very often a bad plugin URL. If a download URL redirects to a project homepage,
the downloader writes the HTML page where a jar belonged and the server dies
with a stack trace that never mentions the URL. Prefer `modrinth` or `hangar`
references, which cannot rot this way. Check your `plugins` entries
actually return a jar:

```sh
curl -sIL -o /dev/null -w "%{http_code} %{content_type}\n" "<the url>"
```

You want `application/java-archive`, not `text/html`.

### It restarts with exit code 137

The container hit its memory cap and the kernel killed it. The server log just
stops, with no error. Confirm with:

```sh
docker inspect --format "{{.State.OOMKilled}}" <network>-<server>
```

If several servers die this way at once, the network does not fit in Docker's
memory at all — `cloud apply` warns about that before it starts anything
("this network may use up to …"). On Docker Desktop the limit is the VM's, set
under Settings → Resources, not the machine's.

For a single server, `true` means the JVM needed more than its heap allows for. Raise
`memory_limit` on that group (or the proxy); see
[Configuration](configuration.md#memory). Raising `memory` alone does not help
if the cap is derived from it, because the headroom stays the same size.

### `Unable to connect you to lobby`

The backend is still starting. Paper's first boot generates a world and takes a
minute or more. `cloud logs lobby -f`.

## Docker problems

### `docker not found on PATH`

Install Docker, or on Windows start Docker Desktop — the CLI is only on `PATH`
while the engine is running.

### `cannot reach the Docker engine`

Start Docker Desktop and wait for "Engine running".

### A port is already allocated

Something else is on `entry_port`. Change it in `[network]`, or stop the other
service.

```sh
cloud apply
```

## Updates and restarts

### An update dropped everyone

A plain `cloud apply` recreates every changed container at once. Use
`cloud apply --rolling` for groups with `min > 1`, and note that recreating the
**proxy** reconnects everybody no matter what — there is only one of it.

### A rollout stopped halfway

That is the intended behaviour:

```
error lobby-1 was still not ready after 300s.
  Nothing else was touched — the remaining instances are still running.
```

The rest of the group is still on the previous version. Fix the cause
(`cloud logs lobby-1`), then apply again.

## Files

### My plugin config edits keep reverting

The group has a `template`. The template owns those files and is re-applied on
every start. Edit `templates/<name>/` instead — see
[Server files](server-files.md).

### I cannot find my world

Only a `static` group with `storage = "bind"` keeps its world on the host, in
`./data/<server>/`. Otherwise it is in a Docker named volume, which is
deliberate: worlds are what make bind mounts slow on Docker Desktop.

Plugin files are always on the host, in `./data/<server>/plugins/`.

### A generated file I edited was overwritten

`docker-compose.yml`, `proxy/velocity.toml`, `proxy/config.yml` and
`proxy/patches/` are rewritten on every apply. Change `cloud.toml` instead. If
something you need is not expressible there, use a Compose override —
[Integrations](integrations.md).

## Windows

See [Windows](windows.md) for storage performance, permissions, console
encoding and WSL specifics.
