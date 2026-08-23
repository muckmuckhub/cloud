/**
 * Checks the docs site for the two things that rot silently: a page missing
 * from the navigation, and a link to a page that no longer exists.
 *
 * `mkdocs build --strict` catches both, but only in a job that has Python
 * installed. This runs in `bun run check` alongside everything else, so a
 * broken link fails before the docs job ever starts.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { parse as parseYaml } from "yaml";

const DOCS = "docs";
const CONFIG = "mkdocs.yml";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

/** Nav entries are either "file.md" or { Title: "file.md" } or nested lists. */
function navFiles(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const n of node) navFiles(n, out);
  else if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) navFiles(v, out);
  }
  return out;
}

const config = parseYaml(await readFile(CONFIG, "utf8")) as {
  nav?: unknown;
  site_name?: string;
};

check("mkdocs.yml parses and names the site", !!config.site_name);

const inNav = navFiles(config.nav);
const onDisk = (await readdir(DOCS)).filter((f) => f.endsWith(".md"));

console.log("\nnavigation");
for (const page of inNav) {
  check(`${page} exists`, existsSync(join(DOCS, page)));
}
for (const page of onDisk) {
  check(`${page} is in the nav`, inNav.includes(page), "add it to nav in mkdocs.yml");
}

console.log("\nlinks");
// [text](target) — skipping images, anchors and absolute URLs.
const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
for (const page of onDisk) {
  const body = await readFile(join(DOCS, page), "utf8");
  const broken: string[] = [];
  for (const [, rawTarget] of body.matchAll(LINK)) {
    const target = rawTarget.split(" ")[0]; // strip a title, if any
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [path] = target.split("#");
    if (!path) continue; // pure anchor
    const resolved = normalize(join(DOCS, dirname(page), path));
    if (!existsSync(resolved)) broken.push(target);
  }
  check(`${page} links resolve`, broken.length === 0, broken.join(", "));
}

console.log("");
if (failures) {
  console.error(`${failures} docs problem(s)`);
  process.exit(1);
}
console.log("docs are consistent");
