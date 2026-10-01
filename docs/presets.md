# Presets

A preset is a fragment of config with a name. `cloud add` merges it into
`cloud.toml`, shows you the diff, and waits for confirmation.

```sh
cloud add                # list what is available
cloud add geyser
```

```
geyser · Bedrock Edition crossplay via Geyser + Floodgate
  https://geysermc.org/wiki/geyser/setup/

cloud.toml
  + plugins  = ["https://.../geyser/...", "https://.../floodgate/..."]
  + ports    = ["19132:19132/udp"]

Add "geyser"? [y/N]
```

Nothing is written until you say yes, and the result goes through exactly the
same validation as a hand-written `cloud.toml`. A preset gets no privileges: it
is data, it cannot run code, and the worst a broken one can do is fail
validation with a readable message.

Applying the same preset twice is a no-op rather than a duplicated plugin list.

<video src="assets/demos/add.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud add, then cloud add viaversion"></video>

## What ships

| Preset | What it does |
|---|---|
| `geyser` | Bedrock crossplay via Geyser + Floodgate, and publishes UDP 19132 on the proxy |
| `viaversion` | Lets older and newer clients connect to your server version |
| `luckperms` | Permissions, on the proxy and every backend |
| `creative` | Adds a persistent creative-mode server |

Each prints anything you still have to do by hand after applying — a firewall
port, a key to share, a database to point at.

## Writing one

Presets live in one file, `packages/cli/src/presets/registry.ts`. Adding one is
adding an entry and opening a pull request. There is no build step, no loader,
and no registration API.

```ts
const MY_PRESET: Preset = {
  name: "example",
  description: "One line, shown in `cloud add`",
  docs: "https://link-to-what-this-installs",
  proxyPlugins: ["https://..."],
  allGroupPlugins: ["https://..."],
  allGroupHangar: ["ViaVersion:5.11.0"],        // preferred: slug:version
  allGroupModrinth: ["some-plugin:1.2.3"],
  proxyHangar: ["SomeProxyPlugin:1.0.0"],
  proxyModrinth: ["some-proxy-plugin:1.0.0"],
  allGroupEnv: { SOME_SETTING: "value" },
  proxyEnv: { SOME_SETTING: "value" },
  proxyPorts: ["19132:19132/udp"],   // proxy only; backends never publish
  groups: { creative: { memory: "2G" } },
  notes: ["Anything the user still has to do by hand"],
};
```

Rules:

- **Config only.** If it needs code, it is not a preset.
- **Existing values win.** A preset must never silently change something the
  user set by hand.
- **Ports go on the proxy.** A preset cannot open a port on a backend, and CI
  asserts it.
- **Pin a version.** Prefer a Hangar or Modrinth `slug:version` reference
  over a URL — the version is the whole reference, so there is no path that can
  start redirecting. Otherwise prefer official download URLs over mirrors, and
  do not use a `/latest/` path unless you have checked that it really serves a
  jar.

That last rule is not theoretical. Two presets once shipped `/latest/` URLs
that had quietly started redirecting to a project homepage; the downloader
wrote the HTML page where a jar belonged, and the server crash-looped with a
Java stack trace that never mentions the URL.

```sh
bun run links      # checks every preset URL and reference still resolves
```

CI runs that weekly, so link rot surfaces on its own instead of in someone's
server. Each preset carries a comment naming the upstream API that lists the
current version.

## What CI asserts about every preset

- It produces a valid config from a minimal base.
- It does not mutate its input.
- Applying it twice changes nothing.
- It opens ports on the proxy and nowhere else.
- It has a description, and a docs link if it installs jars.
- It still validates next to a Fabric group: plugin jars and references
  meant for "every group" skip mod servers, which cannot load them.
- Its Hangar and Modrinth references reach the rendered container.
