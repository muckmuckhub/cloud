import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudConfigSchema, type CloudConfig } from "@cloud/schema";

/**
 * Builds a valid config from a partial one. Tests state only the field under
 * test, so a new schema default does not mean editing every test.
 */
export function config(over: Record<string, unknown> = {}): CloudConfig {
  const base = {
    network: { name: "test" },
    groups: { lobby: { version: "1.21.10", fallback: true } },
  };
  return CloudConfigSchema.parse({ ...base, ...over });
}

/** Runs `fn` in a fresh temp directory that is removed afterwards. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cloud-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
