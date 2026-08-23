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
}

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
      };
    case "legacy":
      // No secret at all. Safe only because backends publish no port.
      return {
        usesSecret: false,
        velocityEnabled: false,
        bungeeEnabled: true,
        legacyStyle: true,
      };
    case "none":
      // Rejected by the schema; handled so this stays a total function.
      return {
        usesSecret: false,
        velocityEnabled: false,
        bungeeEnabled: false,
        legacyStyle: false,
      };
  }
}

/** The generated proxy config file, which differs per proxy software. */
export function proxyConfigFile(software: CloudConfig["proxy"]["software"]): string {
  return software === "velocity" ? "proxy/velocity.toml" : "proxy/config.yml";
}
