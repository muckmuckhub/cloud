# Forwarding and the security model

## Why backends publish no port

Every backend listens on 25565 inside its own network namespace and is reached
by container name over Docker's embedded DNS. There is no port allocator
because there are no host ports to allocate.

This is a security property, not a convenience. Backends run
`online-mode=false`: they do not authenticate players themselves, they trust
whatever the proxy tells them about a player's identity. If a backend were
reachable from the internet, anyone could connect to it directly and claim any
UUID — including an operator's.

Modern forwarding's signature is the second line of defence. Not publishing the
port is the first.

The tool enforces this on its own output, and warns when a Compose override
tries to bypass it — see [Integrations](integrations.md).

## Forwarding modes

| Mode | Proxies | Secret | Backend wiring | Extra setup |
|---|---|---|---|---|
| `modern` | Velocity only | yes | `proxies.velocity.*` in `paper-global.yml` | none |
| `bungeeguard` | any | yes, a token | `settings.bungeecord: true` | BungeeGuard plugin on proxy and every backend |
| `legacy` | any | no | `settings.bungeecord: true` | none |
| `none` | — | — | — | rejected |

`modern` is the default and the right answer with Velocity.

`forwarding = "none"` is rejected by validation: it gives every player an
offline-mode UUID and leaves backends unauthenticated.

`modern` on a non-Velocity proxy is also rejected, at parse time. BungeeCord
has no implementation of it, so the proxy would start, listen, and refuse every
login with *"Unable to verify player identity"* — indistinguishable from a bad
secret, and from a completely different cause.

## The three settings that must agree

This is where most Velocity setups break. All of them are derived for you; the
table is here so the generated files make sense.

| File | Setting | Value under `modern` |
|---|---|---|
| `server.properties` | `online-mode` | `false` |
| `paper-global.yml` | `proxies.velocity.enabled` | `true` |
| `paper-global.yml` | `proxies.velocity.online-mode` | mirrors `network.online` |
| `paper-global.yml` | `proxies.velocity.secret` | the forwarding secret |
| `spigot.yml` | `settings.bungeecord` | `false` |

The trap is the two `online-mode` values. They mean opposite things:
`server.properties` says "do not authenticate players yourself", while
`paper-global.yml` says "the proxy authenticated this player". Setting both the
same breaks skins, or breaks login.

Under `legacy` and `bungeeguard` it is the mirror image: `velocity.enabled` is
`false` and `settings.bungeecord` is `true`. Exactly one of the two styles is
ever on.

Paper writes `paper-global.yml` on first boot, so these are applied by the
image's patch mechanism after generation and before the JVM starts.

## The forwarding secret

Generated locally on first `cloud apply`, written to
`proxy/forwarding.secret`, and mirrored into `.env` as `FORWARDING_SECRET` from
the same variable in the same operation. Both are gitignored.

Two details that matter:

- **No trailing newline.** A stray byte here produces "Unable to verify player
  identity" with nothing useful in the logs. This is the single most common
  cause of a broken handshake.
- **Owner-only permissions.** `chmod 600` on Linux and macOS; on Windows the
  equivalent ACL, because `chmod` there only toggles a read-only bit. If that
  fails, `cloud apply` warns rather than leaving a secret readable by every
  account on the machine without telling you.

The secret never enters an AI prompt.

### Rotating it

```sh
cloud apply --rotate-secret
```

Rotation needs every backend to restart, because Paper reads
`paper-global.yml` once at boot — which is why it is a flag on `apply` rather
than a command of its own. The new value reaches containers through `.env`
interpolation, so Compose sees changed environment and recreates them as part
of the same reconcile.

## BungeeGuard

`bungeeguard` gives BungeeCord-style forwarding plus a token that the
BungeeGuard plugin checks on both ends. `cloud` generates the token and hands
it to every backend as `CFG_FORWARDING_SECRET`, but the plugin keeps its
allowlist in its own config file, which it only creates on first boot. So:

```sh
cloud apply                      # start once, let the plugin generate its config
cat proxy/forwarding.secret      # the token
```

Put that token in `allowed-tokens` in `plugins/BungeeGuard/config.yml` on every
backend and in the proxy's BungeeGuard config, then `cloud restart`.

`legacy` skips all of that and needs no plugin. It is safe only because
backends publish no port — anyone who *could* reach a backend directly could
claim any UUID.

## DNS

If you set `domain` in `[network]`, `cloud init` prints the records players
need so they can omit the port:

```
_minecraft._tcp.play.example.com. 300 IN SRV 0 5 25565 play.example.com.
play.example.com.                 300 IN A   <your server ip>
```

On Cloudflare that record must be DNS-only (grey cloud). The proxy does not
carry Minecraft traffic.
