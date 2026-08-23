import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { CloudConfigSchema, type CloudConfig } from "@cloud/schema";

export const CONFIG_FILE = "cloud.toml";

export class ConfigError extends Error {}

/** Walks up from cwd looking for cloud.toml, like git finds .git. */
export function findRoot(from = process.cwd()): string | null {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    // dirname, not join(dir, ".."): it reaches a fixpoint at drive roots
    // (C:\) and UNC shares (\\server\share) as well as POSIX /.
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRoot(): string {
  const root = findRoot();
  if (!root) {
    throw new ConfigError(
      `no ${CONFIG_FILE} found here or in any parent directory.\n` +
        `Run \`cloud init\` to create one.`,
    );
  }
  return root;
}

export async function loadConfig(root: string): Promise<CloudConfig> {
  const path = join(root, CONFIG_FILE);
  let raw: unknown;
  try {
    raw = parseToml(await readFile(path, "utf8"));
  } catch (err) {
    throw new ConfigError(
      `${CONFIG_FILE} is not valid TOML:\n  ${(err as Error).message}`,
    );
  }

  const result = CloudConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`${CONFIG_FILE} is invalid:\n${issues}`);
  }
  return result.data;
}

export async function saveConfig(root: string, text: string): Promise<void> {
  await writeFile(join(root, CONFIG_FILE), text, "utf8");
}
