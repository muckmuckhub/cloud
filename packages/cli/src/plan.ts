import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { hostDirs, instanceNames, renderCompose } from "./render/compose.ts";
import {
  renderBungeeConfig,
  renderVelocityToml,
  renderPaperPatches,
} from "./render/proxy.ts";
import { proxyConfigFile } from "./render/forwarding.ts";
import type { CloudConfig } from "./types.ts";
import { c } from "./ui.ts";

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
 * Minimal line diff. Not a full Myers implementation — for generated files
 * that are rewritten wholesale, a common-prefix/suffix trim shows the
 * interesting part and keeps the output honest about what changed.
 */
export function renderDiff(ch: FileChange): string {
  if (ch.prev === null) {
    const n = ch.next.split("\n").length;
    return `${c.green("+")} ${c.bold(ch.path)} ${c.dim(`(new, ${n} lines)`)}`;
  }
  const a = ch.prev.split("\n");
  const b = ch.next.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const removed = a.slice(start, endA + 1);
  const added = b.slice(start, endB + 1);

  const lines = [`${c.yellow("~")} ${c.bold(ch.path)}`];
  const cap = 40;
  for (const l of removed.slice(0, cap)) lines.push(c.red(`  - ${l}`));
  if (removed.length > cap)
    lines.push(c.dim(`  … ${removed.length - cap} more removed`));
  for (const l of added.slice(0, cap)) lines.push(c.green(`  + ${l}`));
  if (added.length > cap)
    lines.push(c.dim(`  … ${added.length - cap} more added`));
  return lines.join("\n");
}

export function summarise(root: string, changes: FileChange[]): string {
  if (!changes.length) return c.dim("No changes to generated files.");
  return changes.map(renderDiff).join("\n\n") + "\n";
}

export function relToRoot(root: string, p: string): string {
  return relative(root, p) || ".";
}
