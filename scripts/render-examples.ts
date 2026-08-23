/**
 * Regenerates the artifacts checked into examples/.
 *
 * Those files exist so a reader can see what a config turns into without
 * running anything, which only works if they are what the renderers currently
 * produce. CI asserts that; this script is how you fix it after touching a
 * renderer:
 *
 *   bun run examples
 *
 * The forwarding secret is deliberately not generated here. It is per-machine,
 * gitignored, and created by `cloud apply`.
 */
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { CloudConfigSchema } from "@cloud/schema";
import { generatedFiles } from "../packages/cli/src/plan.ts";

const EXAMPLES = "examples";

let wrote = 0;
for (const example of await readdir(EXAMPLES)) {
  const dir = join(EXAMPLES, example);
  const tomlPath = join(dir, "cloud.toml");
  let raw: unknown;
  try {
    raw = parseToml(await Bun.file(tomlPath).text());
  } catch {
    continue; // not an example, or no config in it
  }

  const parsed = CloudConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`${tomlPath} is invalid:`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }

  for (const [rel, body] of Object.entries(generatedFiles(parsed.data))) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
    console.log(`  ${abs}`);
    wrote++;
  }
}

console.log(`\n${wrote} file(s) written`);
