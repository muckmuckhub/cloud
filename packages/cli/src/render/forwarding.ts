import type { CloudConfig } from "../types.ts";

/**
 * How one forwarding mode maps onto the three switches that have to agree.
 *
 * These have burned people repeatedly because they look like they mean the
 * same thing and do not:
 *
 *   server.properties  online-mode              always false. The proxy authenticates.
 *   paper-global.yml   proxies.velocity.*       modern forwarding, Velocity only
 *   spigot.yml         settings.bungeecord      legacy forwarding, any proxy
 *
 * Setting the Paper/Spigot pair to the same value as server.properties breaks
 * either skins (all false) or login (all true). Deriving all of them from one
 * table is the point of this module: a new forwarding mode is one row here,
 * not four scattered conditionals.
 */
export interface ForwardingWiring {
  /** A shared secret exists and must reach the proxy. */
  usesSecret: boolean;
  /** paper-global.yml proxies.velocity.enabled */
  velocityEnabled: boolean;
  /** spigot.yml settings.bungeecord, and paper's bungee-cord section */
  bungeeEnabled: boolean;
  /** The proxy needs backends configured for BungeeCord-style forwarding. */
  legacyStyle: boolean;
  /**
   * Backends check a BungeeGuard token. The plugin is installed, and its
   * `allowed-tokens` set to the forwarding secret, by this tool.
   */
  guard: boolean;
  /** Proxy-Compatible-Forge's name for this mode, on NeoForge servers. */
  pcfMode: "MODERN" | "BUNGEEGUARD" | "LEGACY";
}

/**
 * BungeeGuard, pinned. One jar serves BungeeCord/Waterfall and Paper alike;
 * Velocity has it built in (`player-info-forwarding-mode = "bungeeguard"`)
 * and needs no jar. Installed automatically because the mode is meaningless
 * without it: backends without the plugin accept any forwarded identity, which
 * is exactly `legacy` with a token nobody checks. `bun run links` verifies the
 * URL; refresh from https://github.com/lucko/BungeeGuard/releases
 */
export const BUNGEEGUARD_JAR =
  "https://github.com/lucko/BungeeGuard/releases/download/v1.4.0/BungeeGuard.jar";

export function wiringFor(forwarding: CloudConfig["network"]["forwarding"]): ForwardingWiring {
  switch (forwarding) {
    case "modern":
      // Velocity's signed handshake. The only mode where the backend verifies
      // anything itself.
      return {
        usesSecret: true,
        velocityEnabled: true,
        bungeeEnabled: false,
        legacyStyle: false,
        guard: false,
        pcfMode: "MODERN",
      };
    case "bungeeguard":
      // BungeeCord-style forwarding plus a token the BungeeGuard plugin checks.
      // Paper still sees plain bungeecord forwarding; the token is the plugin's
      // business, not the server's.
      return {
        usesSecret: true,
        velocityEnabled: false,
        bungeeEnabled: true,
        legacyStyle: true,
        guard: true,
        pcfMode: "BUNGEEGUARD",
      };
    case "legacy":
      // No secret at all. Safe only because backends publish no port.
      return {
        usesSecret: false,
        velocityEnabled: false,
        bungeeEnabled: true,
        legacyStyle: true,
        guard: false,
        pcfMode: "LEGACY",
      };
  }
}

/** The generated proxy config file, which differs per proxy software. */
export function proxyConfigFile(software: CloudConfig["proxy"]["software"]): string {
  return software === "velocity" ? "proxy/velocity.toml" : "proxy/config.yml";
}
