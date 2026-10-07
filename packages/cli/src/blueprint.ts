import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

/**
 * A blueprint is a cloud.toml someone wants more networks like: the proxy,
 * the memory, the groups — everything but the one network it belongs to. It
 * is not a new format and has no registry. Any cloud.toml is one: a file, a
 * project directory (whose templates/ come along), or a URL to a raw file.
 *
 * `cloud init --from <blueprint> --version 26.2` makes a new project from it,
 * next to the networks already running: its own name and its own port, both
 * written into the new cloud.toml like every other choice init makes.
 */
export interface Blueprint {
  text: string;
  /** A project directory with templates/, when the blueprint came from one. */
  templatesDir: string | null;
  source: string;
}

export class BlueprintError extends Error {}

export async function loadBlueprint(from: string): Promise<Blueprint> {
  if (/^https?:\/\//i.test(from)) {
    let res: Response;
    try {
      res = await fetch(from, { signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new BlueprintError(`could not fetch ${from}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new BlueprintError(`${from} answered ${res.status}.`);
    const text = await res.text();
    // A GitHub page instead of the raw file is the usual mistake, and parses
    // as nothing useful. Say which URL to use instead.
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new BlueprintError(
        `${from} is a web page, not a cloud.toml.\n` +
          `  On GitHub use the "Raw" link (raw.githubusercontent.com/...).`,
      );
    }
    return { text, templatesDir: null, source: from };
  }
  if (!existsSync(from)) throw new BlueprintError(`${from} does not exist.`);
  const isDir = statSync(from).isDirectory();
  const file = isDir ? join(from, "cloud.toml") : from;
  if (!existsSync(file)) throw new BlueprintError(`${from} has no cloud.toml.`);
  const templates = isDir ? join(from, "templates") : null;
  return {
    text: await readFile(file, "utf8"),
    templatesDir: templates && existsSync(templates) ? templates : null,
    source: from,
  };
}

/**
 * The new network's name. Two networks with one name would fight over the
 * same container names, so a version gets appended: mynetwork-26-2. Kept
 * within the 32 characters a name may have.
 */
export function networkName(base: string, version?: string): string {
  if (!version) return base;
  const suffix = `-${version.replace(/\./g, "-")}`;
  return base.slice(0, 32 - suffix.length).replace(/-+$/, "") + suffix;
}

/** True when nothing on this machine listens on the port. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer()
      .once("error", () => done(false))
      .once("listening", () => server.close(() => done(true)))
      .listen(port, "0.0.0.0");
  });
}

/**
 * The first free port from `start` on. Checked once, by init, and written
 * into cloud.toml — the renderer never looks at the machine.
 */
export async function freePort(start: number): Promise<number> {
  for (let port = start; port < start + 100 && port <= 65535; port++) {
    if (await portFree(port)) return port;
  }
  throw new BlueprintError(`no free port between ${start} and ${start + 99}. Pass --port.`);
}
