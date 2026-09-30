import type { Preset } from "./types.ts";

/**
 * To contribute a preset: add an entry here and open a PR. That is the whole
 * process — no build step, no registration API, no plugin loader.
 *
 * Rules for a good preset:
 *   - it must be config only; if it needs code, it is not a preset
 *   - link `docs` to something that explains what is being installed
 *   - prefer official download URLs over mirrors
 *   - put anything the user must still do by hand in `notes`
 */

const GEYSER: Preset = {
  name: "geyser",
  description: "Bedrock Edition crossplay via Geyser + Floodgate",
  docs: "https://geysermc.org/wiki/geyser/setup/",
  proxyPlugins: [
    "https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/velocity",
    "https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/velocity",
  ],
  allGroupPlugins: [
    "https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot",
  ],
  // Bedrock's protocol is UDP on 19132, alongside the Java port. This is the
  // one case where something other than Minecraft-over-TCP has to reach the
  // proxy, and it stays on the proxy — no backend gains a published port.
  proxyPorts: ["19132:19132/udp"],
  notes: [
    "Geyser listens on UDP 19132, now published on the proxy.",
    "Open that port on your firewall too — UDP, not TCP.",
    "Bedrock players appear with a prefix (default '.') on their username.",
    "Floodgate needs its key shared between proxy and backends — see the docs link.",
  ],
};

const VIAVERSION: Preset = {
  name: "viaversion",
  description: "Let older and newer clients connect to your server version",
  docs: "https://docs.viaversion.com/",
  // Version-pinned, because Hangar has no stable "latest jar" URL and the
  // /versions/LATEST/ path these used to point at now 404s — which reaches the
  // user as a crash-looping server, not as a download error. `bun run links`
  // checks these still resolve to a jar; refresh with
  //   curl https://hangar.papermc.io/api/v1/projects/ViaVersion/latestrelease
  allGroupHangar: ["ViaVersion:5.11.0", "ViaBackwards:5.11.0"],
  notes: [
    "Install on the BACKENDS, not the proxy — Velocity handles protocol translation poorly.",
    "ViaBackwards lets older clients in; ViaRewind (not included) goes further back than 1.8.",
  ],
};

const LUCKPERMS: Preset = {
  name: "luckperms",
  description: "Permissions, on the proxy and every backend",
  docs: "https://luckperms.net/wiki/Home",
  // Version-pinned for the same reason as ViaVersion: the /latest/ paths these
  // used to use now redirect to the project homepage, so the "jar" downloaded
  // was an HTML page. Refresh from the build metadata API, which lists the
  // current jar per platform:
  //   curl https://metadata.luckperms.net/data/all
  proxyPlugins: [
    "https://download.luckperms.net/1664/velocity/LuckPerms-Velocity-5.5.77.jar",
  ],
  allGroupPlugins: [
    "https://download.luckperms.net/1664/bukkit/loader/LuckPerms-Bukkit-5.5.77.jar",
  ],
  notes: [
    "By default each server keeps its own permission database.",
    "For network-wide permissions, point them all at one MySQL instance — see the docs link.",
  ],
};

const CREATIVE: Preset = {
  name: "creative",
  description: "Adds a persistent creative-mode server",
  groups: {
    creative: {
      memory: "2G",
      static: true,
      env: {
        MODE: "creative",
        DIFFICULTY: "peaceful",
        SPAWN_PROTECTION: "0",
      },
    },
  },
  notes: ["Inherits the Minecraft version of your first existing group."],
};

export const PRESETS: Record<string, Preset> = {
  [GEYSER.name]: GEYSER,
  [VIAVERSION.name]: VIAVERSION,
  [LUCKPERMS.name]: LUCKPERMS,
  [CREATIVE.name]: CREATIVE,
};
