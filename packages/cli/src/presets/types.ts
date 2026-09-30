import { runsPlugins } from "@cloud/schema";
import type { CloudConfig } from "../types.ts";

/**
 * A preset is pure data — no code, no hooks, no API surface. It describes
 * additions to a config, and the result is validated by the same schema as a
 * hand-written cloud.toml.
 *
 * This is deliberately not a module system. A preset cannot run, cannot
 * observe, and cannot participate in rendering. The worst a broken one can do
 * is fail validation with a readable message.
 */
export interface Preset {
  name: string;
  description: string;
  /** Where a user goes to understand what this actually installs. */
  docs?: string;
  /** Plugin URLs appended to the proxy. */
  proxyPlugins?: string[];
  /**
   * Extra ports published on the proxy, e.g. `19132:19132/udp` for Geyser.
   * Only the proxy may publish ports; a preset cannot open one on a backend.
   */
  proxyPorts?: string[];
  /** Modrinth `slug:version` references appended to the proxy. */
  proxyModrinth?: string[];
  /** Hangar `slug:version` references appended to the proxy. */
  proxyHangar?: string[];
  /** Plugin URLs appended to every existing group that runs plugins (not Fabric). */
  allGroupPlugins?: string[];
  /** Modrinth `slug:version` references appended to every existing plugin group. */
  allGroupModrinth?: string[];
  /**
   * Hangar `slug:version` references appended to every existing group.
   * Preferred over a hand-built Hangar URL: the version is the whole reference,
   * so there is no path that can quietly start 404ing.
   */
  allGroupHangar?: string[];
  /** Environment variables merged into every existing group. */
  allGroupEnv?: Record<string, string>;
  /** Environment merged into the proxy. */
  proxyEnv?: Record<string, string>;
  /** Whole new groups. Names must not collide with existing ones. */
  groups?: Record<string, Partial<CloudConfig["groups"][string]> & { version?: string }>;
  /** Printed after applying — port forwards, next steps, caveats. */
  notes?: string[];
}

export class PresetError extends Error {}

function mergeUnique(a: string[], b: string[]): string[] {
  const seen = new Set(a);
  return [...a, ...b.filter((x) => !seen.has(x))];
}

/**
 * Returns a NEW config. Never mutates the input, so a rejected preset leaves
 * nothing behind.
 */
export function applyPreset(cfg: CloudConfig, preset: Preset): CloudConfig {
  const next: CloudConfig = structuredClone(cfg);

  if (preset.proxyPlugins?.length) {
    next.proxy.plugins = mergeUnique(next.proxy.plugins, preset.proxyPlugins);
  }
  if (preset.proxyModrinth?.length) {
    next.proxy.modrinth = mergeUnique(next.proxy.modrinth, preset.proxyModrinth);
  }
  if (preset.proxyHangar?.length) {
    next.proxy.hangar = mergeUnique(next.proxy.hangar, preset.proxyHangar);
  }
  if (preset.proxyPorts?.length) {
    next.proxy.ports = mergeUnique(next.proxy.ports, preset.proxyPorts);
  }
  if (preset.proxyEnv) {
    // Existing values win, same rule as groups: a preset must never silently
    // change something the user set by hand.
    next.proxy.env = { ...preset.proxyEnv, ...next.proxy.env };
  }

  for (const groupName of Object.keys(next.groups)) {
    const group = next.groups[groupName];
    // "All groups" means all groups that run plugins. A Bukkit jar in a
    // Fabric server is not loaded, and a Hangar reference is rejected by the
    // schema — so adding one would turn `cloud add luckperms` into an
    // invalid config for anyone with a Fabric group. Environment still
    // applies: it is not a jar.
    const plugins = runsPlugins(group.software);
    if (preset.allGroupPlugins?.length && plugins) {
      group.plugins = mergeUnique(group.plugins, preset.allGroupPlugins);
    }
    if (preset.allGroupModrinth?.length && plugins) {
      group.modrinth = mergeUnique(group.modrinth, preset.allGroupModrinth);
    }
    if (preset.allGroupHangar?.length && plugins) {
      group.hangar = mergeUnique(group.hangar, preset.allGroupHangar);
    }
    if (preset.allGroupEnv) {
      // Existing values win — a preset must never silently change something
      // the user set by hand.
      group.env = { ...preset.allGroupEnv, ...group.env };
    }
  }

  for (const [name, spec] of Object.entries(preset.groups ?? {})) {
    if (next.groups[name]) {
      throw new PresetError(
        `preset "${preset.name}" wants to add a group called "${name}", but you already have one.\n` +
          `  Rename or remove yours first.`,
      );
    }
    // A preset that names no version inherits the one already in use, so
    // `cloud add creative` cannot quietly introduce a second Minecraft version.
    // Pulled out of the spread because an explicit `version: undefined` in a
    // preset would otherwise erase the inherited value.
    const { version: requested, ...rest } = spec;
    const version =
      requested ?? Object.values(cfg.groups)[0]?.version ?? "1.21.10";
    next.groups[name] = {
      software: "paper",
      memory: "2G",
      min: 1,
      fallback: false,
      static: false,
      plugins: [],
      modrinth: [],
      hangar: [],
      env: {},
      ...rest,
      version,
    } as CloudConfig["groups"][string];
  }

  return next;
}
