import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  hostDirOwners,
  hostDirs,
  hostPluginDir,
  instanceNames,
  renderCompose,
} from "./render/compose.ts";
import {
  renderBungeeConfig,
  renderNeoForgePatches,
  renderVelocityToml,
  renderPaperPatches,
} from "./render/proxy.ts";
import { proxyConfigFile } from "./render/forwarding.ts";
import { containerLimitMiB, memoryMiB, runsPlugins } from "@cloud/schema";
import type { CloudConfig } from "./types.ts";
import { c } from "./ui.ts";
import { ownershipMatters, ownTree, processUid } from "./platform.ts";
import { formatDiff } from "./diff.ts";

export interface FileChange {
  path: string;
  next: string;
  prev: string | null;
}

/**
 * Every file `cloud apply` writes, keyed by path relative to the project root.
 *
 * Exported because the example renderer and the invariant checker must agree
 * with apply about what "generated" means — a file only one of them knows
 * about is a file that ships stale.
 */
export const generatedFiles = (cfg: CloudConfig) => {
  // Velocity reads velocity.toml; BungeeCord and Waterfall read config.yml.
  // Which file to write and where compose mounts it come from the same
  // helper, so the two can never disagree.
  const files: Record<string, string> = {
    "docker-compose.yml": renderCompose(cfg),
    [proxyConfigFile(cfg.proxy.software)]:
      cfg.proxy.software === "velocity"
        ? renderVelocityToml(cfg)
        : renderBungeeConfig(cfg),
  };
  for (const [name, body] of Object.entries(renderPaperPatches(cfg))) {
    files[`proxy/patches/${name}`] = body;
  }
  // A subdirectory, because the patcher reads only the files directly in the
  // directory it is given: Paper servers mount proxy/patches and never see
  // these, NeoForge servers mount proxy/patches/neoforge and see only these.
  for (const [name, body] of Object.entries(renderNeoForgePatches(cfg))) {
    files[`proxy/patches/neoforge/${name}`] = body;
  }
  return files;
};

export async function plan(
  root: string,
  cfg: CloudConfig,
): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  for (const [rel, next] of Object.entries(generatedFiles(cfg))) {
    const abs = join(root, rel);
    const prev = existsSync(abs) ? await readFile(abs, "utf8") : null;
    if (prev !== next) changes.push({ path: rel, next, prev });
  }
  return changes;
}

export async function writeChanges(
  root: string,
  changes: FileChange[],
): Promise<void> {
  for (const ch of changes) {
    const abs = join(root, ch.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, ch.next, "utf8");
  }
}

/**
 * Which instances can be cycled one at a time, in order.
 *
 * Only groups running more than one instance: with a single instance there is
 * nothing to fail over to, so taking it down is an outage however slowly you
 * do it. Saying that plainly beats a "rolling" restart that is really just a
 * restart with extra waiting.
 */
export function rollingPlan(cfg: CloudConfig): { group: string; instances: string[] }[] {
  const plan: { group: string; instances: string[] }[] = [];
  for (const [group, g] of Object.entries(cfg.groups)) {
    if (g.min > 1) plan.push({ group, instances: instanceNames(group, g.min) });
  }
  return plan;
}

/**
 * Multi-instance groups a plain `apply` would recreate all at once.
 *
 * Only when docker-compose.yml is being *changed*. A first apply creates it,
 * and warned "every player on them drops" about a network with no players and
 * no containers yet — the first thing a new user saw. A compose file deleted
 * by hand while the network runs slips through; that is rare, and the
 * warning is advice, not a safeguard.
 */
export function recreatedAtOnce(
  changes: FileChange[],
  cfg: CloudConfig,
): { group: string; instances: string[] }[] {
  const compose = changes.find((ch) => ch.path === "docker-compose.yml");
  return compose && compose.prev !== null ? rollingPlan(cfg) : [];
}

export interface MemoryBudget {
  /** Sum of every container's JVM heap. */
  heapMiB: number;
  /** Sum of every container's memory cap — what they may use together. */
  capMiB: number;
}

/** What the whole network is allowed to use, from the same caps compose gets. */
export function memoryBudget(cfg: CloudConfig): MemoryBudget {
  let heapMiB = memoryMiB(cfg.proxy.memory);
  let capMiB = containerLimitMiB(cfg.proxy.memory, cfg.proxy.memory_limit);
  for (const [group, g] of Object.entries(cfg.groups)) {
    const n = instanceNames(group, g.min).length;
    heapMiB += n * memoryMiB(g.memory);
    capMiB += n * containerLimitMiB(g.memory, g.memory_limit);
  }
  return { heapMiB, capMiB };
}

const gib = (mib: number) => `${(mib / 1024).toFixed(1)}G`;

/**
 * Says so when the network cannot fit in the memory Docker has.
 *
 * Caps are ceilings, not reservations, so Docker starts everything anyway —
 * and then, as the heaps fill over the next hour, the kernel kills servers
 * one at a time. That surfaces as random restarts with exit code 137 and
 * nothing in any server log, long after the apply that caused it. Docker
 * Desktop's VM defaults to a fraction of the machine's memory, which makes
 * this easy to hit on a laptop.
 */
export function memoryWarning(budget: MemoryBudget, hostMiB: number): string | null {
  if (!hostMiB || budget.capMiB <= hostMiB) return null;
  const heapsFit = budget.heapMiB <= hostMiB;
  return (
    `this network may use up to ${gib(budget.capMiB)}, but Docker has ${gib(hostMiB)} in total.\n` +
    (heapsFit
      ? `  It starts, but once the heaps fill, servers are killed at random (exit code 137).\n`
      : `  The heaps alone (${gib(budget.heapMiB)}) do not fit — servers will be killed as they fill.\n`) +
    `  Lower memory in cloud.toml, run fewer instances, or give Docker more memory\n` +
    `  (Docker Desktop: Settings → Resources).`
  );
}

/**
 * Templates that are declared but have nothing in them.
 *
 * Seeding from an empty directory is a no-op, and a silent one: the server
 * starts, generates its own defaults, and nothing says the template you
 * configured did nothing. Worth one line of output.
 */
export async function emptyTemplates(
  root: string,
  cfg: CloudConfig,
): Promise<string[]> {
  const empty = new Set<string>();
  for (const g of Object.values(cfg.groups)) {
    if (!g.template) continue;
    const dir = join(root, "templates", g.template);
    try {
      if ((await readdir(dir)).length === 0) empty.add(g.template);
    } catch {
      empty.add(g.template); // missing counts as empty
    }
  }
  return [...empty];
}

/**
 * Creates the host directories the compose file bind-mounts.
 *
 * Docker would create them itself, but as root — leaving a plugins directory
 * you cannot edit without sudo, which defeats the reason it is there. Creating
 * them first means they belong to whoever ran `cloud apply`.
 */
export async function createHostDirs(
  root: string,
  cfg: CloudConfig,
): Promise<void> {
  for (const dir of hostDirs(cfg)) {
    await mkdir(join(root, dir), { recursive: true });
  }
}

/**
 * Hands every host directory a container writes to over to the user the
 * server runs as. Runs after everything apply writes there — directories,
 * seeded configs, the proxy's BungeeGuard token.
 *
 * Run as root on Linux, `cloud apply` created all of it as root:root, and the
 * servers (uid 1000) could not write their own plugins directory: the image
 * repairs ownership only when /data *itself* belongs to someone else, which a
 * named volume never does. The servers crash-looped on AccessDeniedException.
 * As root, this repairs it — existing installations included. As anyone else
 * it cannot, so it returns the directories that are wrong, for a warning that
 * says how to fix them.
 */
export async function fixOwnership(
  root: string,
  cfg: CloudConfig,
): Promise<{ dir: string; uid: number; gid: number }[]> {
  const me = processUid();
  if (!ownershipMatters || me === null) return [];
  const wrong: { dir: string; uid: number; gid: number }[] = [];
  for (const owner of hostDirOwners(cfg)) {
    const path = join(root, owner.dir);
    if (me === 0) {
      await ownTree(path, owner.uid, owner.gid);
      continue;
    }
    const st = await stat(path).catch(() => null);
    if (st && st.uid !== owner.uid) wrong.push(owner);
  }
  return wrong;
}

/**
 * Makes sure every backend has a BungeeGuard config before its first boot.
 *
 * The token itself is patched in at every container start (see
 * renderPaperPatches), but the patcher skips files that do not exist, and the
 * plugin only writes its config after the patches have run. So a fresh
 * backend booted on BungeeGuard's placeholder tokens and rejected every login
 * until its second start. Seeding an almost empty file closes that window;
 * the plugin fills in its default messages itself.
 *
 * Never overwrites: once the file exists it is the operator's, apart from
 * `allowed-tokens`, which the patch owns.
 *
 * Skips a group whose template ships the file. The template is copied in
 * before the patches run, so it is already the seed — and a host-written copy
 * underneath it broke the group on Docker Desktop: files created from Windows
 * or macOS appear inside the container with an owner the image cannot touch,
 * the template sync failed with "Operation not permitted" and the server
 * crash-looped.
 */
export async function seedBungeeGuard(root: string, cfg: CloudConfig): Promise<string[]> {
  const seeded: string[] = [];
  for (const [group, g] of Object.entries(cfg.groups)) {
    // NeoForge implements BungeeGuard itself (Proxy-Compatible-Forge), and
    // the schema keeps Fabric out of this mode altogether.
    if (!runsPlugins(g.software)) continue;
    const fromTemplate =
      g.template &&
      existsSync(join(root, "templates", g.template, "plugins", "BungeeGuard", "config.yml"));
    if (fromTemplate) continue;
    for (const instance of instanceNames(group, g.min)) {
      const file = join(root, hostPluginDir(instance), "BungeeGuard", "config.yml");
      if (existsSync(file)) continue;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        "# Seeded by `cloud apply` for forwarding = \"bungeeguard\".\n" +
          "# allowed-tokens is set to the forwarding secret on every start.\n" +
          "allowed-tokens: []\n",
        "utf8",
      );
      seeded.push(relToRoot(root, file));
    }
  }
  return seeded;
}

/**
 * Makes sure every NeoForge server has a Proxy-Compatible-Forge config before
 * its first boot — the same gap as seedBungeeGuard: the patcher skips a file
 * that does not exist, and the mod writes its defaults, with an empty secret,
 * only once the server is already running. Seeded under config/, which is on
 * the host for mod servers. Skipped when a template ships the file, and never
 * overwritten.
 */
export async function seedNeoForge(root: string, cfg: CloudConfig): Promise<string[]> {
  const seeded: string[] = [];
  for (const [group, g] of Object.entries(cfg.groups)) {
    if (g.software !== "neoforge") continue;
    const fromTemplate =
      g.template &&
      existsSync(join(root, "templates", g.template, "config", "proxy-compatible-forge.toml"));
    if (fromTemplate) continue;
    for (const instance of instanceNames(group, g.min)) {
      const file = join(root, "data", instance, "config", "proxy-compatible-forge.toml");
      if (existsSync(file)) continue;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        "# Seeded by `cloud apply` so Proxy-Compatible-Forge has a config on first boot.\n" +
          "# [forwarding] enabled, mode and secret are set from cloud.toml on every start.\n" +
          "[forwarding]\n" +
          "enabled = true\n",
        "utf8",
      );
      seeded.push(relToRoot(root, file));
    }
  }
  return seeded;
}

/**
 * Minimal line diff. Not a full Myers implementation — for generated files
 * that are rewritten wholesale, a common-prefix/suffix trim shows the
 * interesting part and keeps the output honest about what changed.
 */
export function renderDiff(ch: FileChange): string {
  if (ch.prev === null) {
    const n = ch.next.split("\n").length;
    return `${c.green("+")} ${c.bold(ch.path)} ${c.dim(`(new, ${n} lines)`)}`;
  }
  return `${c.yellow("~")} ${c.bold(ch.path)}\n${formatDiff(ch.prev, ch.next, { cap: 40 })}`;
}

export function summarise(root: string, changes: FileChange[]): string {
  if (!changes.length) return c.dim("No changes to generated files.");
  return changes.map(renderDiff).join("\n\n") + "\n";
}

export function relToRoot(root: string, p: string): string {
  return relative(root, p) || ".";
}
