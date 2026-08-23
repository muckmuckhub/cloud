import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { restrictToOwner } from "./platform.ts";
import { warn } from "./ui.ts";

const SECRET_PATH = ["proxy", "forwarding.secret"];

/**
 * The forwarding secret must be byte-identical in two places: the file
 * Velocity reads, and the value patched into paper-global.yml. A trailing
 * newline in the file is the single most common cause of
 * "Unable to verify player identity" — so we always write without one and
 * always derive both copies from the same variable.
 */
export function generateSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function secretPath(root: string): string {
  return join(root, ...SECRET_PATH);
}

export async function readSecret(root: string): Promise<string | null> {
  const p = secretPath(root);
  if (!existsSync(p)) return null;
  return (await readFile(p, "utf8")).trim();
}

export async function writeSecret(root: string, secret: string): Promise<void> {
  await mkdir(join(root, "proxy"), { recursive: true });
  // No newline. Deliberate.
  await writeFile(secretPath(root), secret, { encoding: "utf8" });
  // chmod is a no-op on Windows; restrictToOwner falls back to icacls there.
  const restricted = await restrictToOwner(secretPath(root));
  await writeEnv(root, secret);
  if (!restricted) {
    // Never silent: a secret every account on the box can read is worth one
    // line of output, and the file is already written by now.
    warn(
      `could not restrict permissions on ${secretPath(root)}.\n` +
        `  Any account on this machine can read the forwarding secret, and\n` +
        `  anyone holding it can join your backends as any player.\n` +
        `  Fix it by hand: chmod 600 (Linux/macOS), or icacls /inheritance:r.`,
    );
  }
}

/** Mirrors the secret into .env so compose interpolation resolves it. */
async function writeEnv(root: string, secret: string): Promise<void> {
  const envPath = join(root, ".env");
  let lines: string[] = [];
  if (existsSync(envPath)) {
    lines = (await readFile(envPath, "utf8"))
      .split("\n")
      .filter((l) => !l.startsWith("FORWARDING_SECRET="));
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push(`FORWARDING_SECRET=${secret}`, "");
  await writeFile(envPath, lines.join("\n"), "utf8");
  await restrictToOwner(envPath);
}

/** Ensures a secret exists, creating one if not. Returns [secret, created]. */
export async function ensureSecret(
  root: string,
): Promise<[string, boolean]> {
  const existing = await readSecret(root);
  if (existing) return [existing, false];
  const secret = generateSecret();
  await writeSecret(root, secret);
  return [secret, true];
}

/**
 * Replaces the secret. Both copies are rewritten from one variable, so they
 * cannot drift.
 *
 * Every backend must restart afterwards: Paper reads paper-global.yml once, at
 * boot. `cloud apply` gets that for free — the value reaches containers through
 * .env interpolation, so Compose sees changed environment and recreates them.
 * Rotating without applying leaves a network that rejects every login.
 */
export async function rotateSecret(root: string): Promise<string> {
  const secret = generateSecret();
  await writeSecret(root, secret);
  return secret;
}
