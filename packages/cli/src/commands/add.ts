import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CloudConfigSchema } from "@cloud/schema";
import { CONFIG_FILE, loadConfig, requireRoot } from "../config.ts";
import { renderCloudToml } from "../render/config.ts";
import { plan, summarise } from "../plan.ts";
import { PRESETS } from "../presets/registry.ts";
import { applyPreset, PresetError } from "../presets/types.ts";
import { c, confirm, fail, info, sym } from "../ui.ts";
import { hasFlag, positionals } from "../args.ts";

/**
 * `cloud add` is the tenth command, which the design notes say needs
 * justifying. It earns its place by folding listing and applying into one
 * verb — `cloud add` with no argument lists what is available — rather than
 * shipping a separate `cloud presets`.
 */
export async function add(argv: string[]): Promise<void> {
  const name = positionals(argv)[0];

  if (!name) {
    info(c.bold("Available presets"));
    info("");
    const width = Math.max(...Object.keys(PRESETS).map((k) => k.length));
    for (const p of Object.values(PRESETS)) {
      info(`  ${c.cyan(p.name.padEnd(width))}  ${p.description}`);
    }
    info("");
    info(c.dim(`  cloud add <name>    add one to this network`));
    return;
  }

  const preset = PRESETS[name];
  if (!preset) {
    fail(
      `unknown preset "${name}".\n` +
        `  Run \`cloud add\` with no arguments to see the list.`,
    );
  }

  const root = requireRoot();
  const current = await loadConfig(root);

  let merged;
  try {
    merged = applyPreset(current, preset);
  } catch (err) {
    if (err instanceof PresetError) fail(err.message);
    throw err;
  }

  // The merged result goes through the same validation as a hand-written
  // config. A preset gets no privileges.
  const parsed = CloudConfigSchema.safeParse(merged);
  if (!parsed.success) {
    fail(
      `preset "${name}" produced an invalid config:\n` +
        parsed.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n"),
    );
  }

  const prevToml = await readFile(join(root, CONFIG_FILE), "utf8");
  const nextToml = renderCloudToml(parsed.data);
  if (prevToml === nextToml) {
    info(c.dim(`"${name}" is already applied — nothing to change.`));
    return;
  }

  info(`${c.bold(preset.name)} ${c.dim("· " + preset.description)}`);
  if (preset.docs) info(c.dim(`  ${preset.docs}`));
  info("");
  info(c.bold(CONFIG_FILE));
  info(diff(prevToml, nextToml));

  const changes = await plan(root, parsed.data);
  if (changes.length) {
    info("");
    info(c.dim("resulting generated files:"));
    info(summarise(root, changes));
  }

  const yes = hasFlag(argv, "-y", "--yes");
  if (!yes && !(await confirm(`Add "${name}"?`, false))) {
    info("Aborted. Nothing written.");
    return;
  }

  await writeFile(join(root, CONFIG_FILE), nextToml, "utf8");
  info(`${c.green(sym.ok)} wrote ${CONFIG_FILE}`);

  if (preset.notes?.length) {
    info("");
    for (const note of preset.notes) info(c.yellow(`  ${note}`));
  }
  info("");
  info(`  next: ${c.bold("cloud apply")}`);
}

function diff(prev: string, next: string): string {
  const a = prev.split("\n");
  const b = next.split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length - 1;
  let eb = b.length - 1;
  while (ea >= s && eb >= s && a[ea] === b[eb]) {
    ea--;
    eb--;
  }
  return [
    ...a.slice(s, ea + 1).map((l) => c.red(`  - ${l}`)),
    ...b.slice(s, eb + 1).map((l) => c.green(`  + ${l}`)),
  ].join("\n");
}
