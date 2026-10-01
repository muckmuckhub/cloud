# Changelog

## 0.2.0

### Upgrading from 0.1.0

Four changes take effect on your next `cloud apply`. Read these first:

- **Every container now has a memory cap.** It is the heap (`memory`) plus a
  quarter, at least 512M more: `2G` gets `2560m`. A server that needs more
  outside its heap — map renderers, mostly — gets `memory_limit` set by hand.
  `apply` warns when the caps add up to more than Docker has.
- **The Velocity default is now the stable `3.5.1`**, instead of
  `3.4.0-SNAPSHOT`. A config that sets `proxy.version` itself is not affected.
- **`forwarding = "bungeeguard"` now installs and configures BungeeGuard**: a
  pinned jar on the backends (and on BungeeCord or Waterfall proxies), its
  token set to the forwarding secret on every start. A `BungeeGuard.jar` you
  list in `plugins` yourself replaces the built-in one rather than loading
  twice.
- **`forwarding = "none"` is gone from the schema.** It never validated; it is
  now also no longer offered to the AI wizard.

### New

- **Fabric and NeoForge servers.** `software = "fabric"` installs
  FabricProxy-Lite, `software = "neoforge"` installs Proxy-Compatible-Forge —
  pinned, with the forwarding secret wired in, nothing to configure. See
  `examples/modded/`.
- **Plugins by reference.** `modrinth = ["slug:version"]` and
  `hangar = ["Slug:version"]` on the proxy and on groups. The version is
  required — references cannot rot the way download URLs did.
- **`cloud status` shows player counts**, and `cloud status --json` gives the
  same as a stable format for scripts and monitoring.
- **`cloud logs --tail N`**, for fewer than the default 200 lines.
- **Image pinning.** `pin = "java21@sha256:…"` freezes an image digest; it is
  refused when it no longer matches the Java version the config needs.
- **`cloud init` asks how many instances** a pooled group runs (default 2).
- **Backups**: a tested `itzg/mc-backup` recipe for
  `docker-compose.override.yml`, restore included. See the Integrations docs.
- **Demo videos** for every command in the documentation.

### Fixed

- **`cloud add` and `cloud ask` keep your `cloud.toml` as you wrote it.** They
  used to rewrite the whole file, dropping every comment. They now change only
  the lines that differ, and say so before asking when a file cannot be edited
  that way.
- **`cloud apply --rotate-secret` never took effect.** The binary held the old
  secret from `.env` and handed it to Compose, so nothing was recreated — and
  the network broke at the next restart of any one server. The proxy is now
  restarted with the backends, too.
- **BungeeCord and Waterfall proxies always reported `unhealthy`.** The
  healthcheck probed the wrong port.
- **A first `cloud apply` warned that players would drop** from a network that
  was not running yet.
- **`cloud add` and `cloud ask` showed nearly the whole file as changed** when
  two lines differed. Diffs now show only what changes.
- **Validation errors are wrapped at word boundaries** instead of being broken
  mid-word by the terminal.
- **The status table lines up** when cells are coloured, and **uptime** is
  how long a container has been running, not how long since it was created.

### For contributors

- The version comes from `packages/cli/package.json`; a test fails if the two
  packages disagree.
- `bun run links` checks every pinned download, including the jars `cloud`
  installs itself.
- `bun run demos` re-records the documentation videos (Docker only).
- `bun run check` fails if a generated example file is ignored by git.
