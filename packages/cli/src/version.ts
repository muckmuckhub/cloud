import { compareMcVersions } from "@cloud/schema";
import type { CloudConfig } from "./types.ts";

/**
 * Switching a whole network to another Minecraft version.
 *
 * `cloud apply --version 26.2` and `cloud init --from … --version 26.2` both
 * come down to this: every group runs the given version. The result goes
 * through the normal schema afterwards, so whatever a version implies — a
 * newer Java, a FabricProxy-Lite release that exists for it, an image pin that
 * no longer fits — is checked exactly as if it had been typed into cloud.toml.
 */
export function withVersion(cfg: CloudConfig, version: string): CloudConfig {
  const next = structuredClone(cfg);
  for (const g of Object.values(next.groups)) g.version = version;
  return next;
}

export interface Downgrade {
  group: string;
  from: string;
  to: string;
}

/**
 * Groups that would move to an older Minecraft version.
 *
 * Minecraft cannot load a world saved by a newer version: the server stops at
 * startup and, under a restart policy, crash-loops. An upgrade converts the
 * world on first load and is fine. So a downgrade of a network that has run
 * is refused unless its worlds are being thrown away anyway (`--recreate`).
 */
export function downgrades(prev: CloudConfig, next: CloudConfig): Downgrade[] {
  const out: Downgrade[] = [];
  for (const [group, g] of Object.entries(next.groups)) {
    const before = prev.groups[group];
    if (before && compareMcVersions(g.version, before.version) < 0) {
      out.push({ group, from: before.version, to: g.version });
    }
  }
  return out;
}
