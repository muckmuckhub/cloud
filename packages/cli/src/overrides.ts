import { existsSync } from "node:fs";
import { join } from "node:path";
import { instanceNames } from "./render/compose.ts";
import type { CloudConfig } from "./types.ts";
import type { PublishedPort } from "./docker.ts";

/**
 * Compose merges these with the generated file automatically, which is the
 * extension point for anything this tool does not model: a database, a
 * Prometheus, a web map. Nothing here reads or writes them — that is the
 * point. They are yours.
 *
 * The names are Compose's own, in its own precedence order.
 */
const OVERRIDE_FILES = [
  "compose.override.yaml",
  "compose.override.yml",
  "docker-compose.override.yaml",
  "docker-compose.override.yml",
];

export function overrideFile(root: string): string | null {
  return OVERRIDE_FILES.find((f) => existsSync(join(root, f))) ?? null;
}

/** Whether a published port is reachable from outside the machine. */
function isPublic(hostIp: string): boolean {
  return hostIp === "" || hostIp === "0.0.0.0" || hostIp === "::";
}

export interface PortWarning {
  service: string;
  port: string;
  /** A generated Minecraft server, as opposed to something the user added. */
  isBackend: boolean;
  message: string;
}

/**
 * Published ports that an override introduced, with the consequence spelled
 * out.
 *
 * Warnings rather than errors: it is the user's file, and binding a Grafana to
 * 127.0.0.1 is a perfectly good reason to publish something. But a backend
 * reachable from the internet defeats the entire forwarding model, and a
 * database on 0.0.0.0 is how people get their world deleted, so neither should
 * happen without someone saying so out loud.
 */
export function portWarnings(
  cfg: CloudConfig,
  ports: PublishedPort[],
): PortWarning[] {
  const backends = new Set<string>();
  for (const [group, g] of Object.entries(cfg.groups)) {
    for (const instance of instanceNames(group, g.min)) backends.add(instance);
  }

  const warnings: PortWarning[] = [];
  for (const p of ports) {
    // The proxy is meant to be published; that is its whole job.
    if (p.service === "proxy") continue;
    if (!isPublic(p.hostIp)) continue;
    const where = `${p.published}/${p.protocol}`;

    if (backends.has(p.service)) {
      warnings.push({
        service: p.service,
        port: where,
        isBackend: true,
        message:
          `${p.service} publishes ${where}, but it is a Minecraft server.\n` +
          `  Backends run online-mode=false and trust the proxy's word about who\n` +
          `  a player is. Anyone who can reach ${p.service} directly can join it as\n` +
          `  any player, including an operator. Remove the ports entry, or bind it\n` +
          `  to 127.0.0.1 if you only need it locally.`,
      });
    } else {
      warnings.push({
        service: p.service,
        port: where,
        isBackend: false,
        message:
          `${p.service} publishes ${where} on every interface.\n` +
          `  Services on the cloud network reach each other by name without any\n` +
          `  published port — a plugin connects to ${p.service} directly. Publish it\n` +
          `  only if something outside Docker needs it, and prefer\n` +
          `  "127.0.0.1:${p.published}:..." so it is not exposed to the internet.`,
      });
    }
  }
  return warnings;
}
