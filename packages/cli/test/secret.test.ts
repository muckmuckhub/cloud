import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureSecret,
  generateSecret,
  readSecret,
  rotateSecret,
  secretPath,
  writeSecret,
} from "../src/secret.ts";
import { withTempDir } from "./helpers.ts";

describe("generateSecret", () => {
  test("is URL-safe, so it survives every config format it passes through", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("is long enough to not be guessable", () => {
    expect(generateSecret().length).toBeGreaterThanOrEqual(32);
  });

  test("differs every time", () => {
    const seen = new Set(Array.from({ length: 100 }, generateSecret));
    expect(seen.size).toBe(100);
  });
});

describe("writeSecret", () => {
  test("writes NO trailing newline", async () => {
    // A trailing byte produces "Unable to verify player identity" with nothing
    // in the logs. This is the single most expensive bug in this codebase.
    await withTempDir(async (dir) => {
      await writeSecret(dir, "abc123");
      const raw = await readFile(secretPath(dir), "utf8");
      expect(raw).toBe("abc123");
      expect(raw.endsWith("\n")).toBe(false);
    });
  });

  test("mirrors the same bytes into .env", async () => {
    await withTempDir(async (dir) => {
      const secret = generateSecret();
      await writeSecret(dir, secret);
      const env = await readFile(join(dir, ".env"), "utf8");
      const fromFile = await readFile(secretPath(dir), "utf8");
      const fromEnv = env
        .split("\n")
        .find((l) => l.startsWith("FORWARDING_SECRET="))
        ?.slice("FORWARDING_SECRET=".length);
      expect(fromEnv).toBe(secret);
      expect(fromFile).toBe(secret);
    });
  });

  test("replaces the previous value in .env rather than appending", async () => {
    await withTempDir(async (dir) => {
      await writeSecret(dir, "first");
      await writeSecret(dir, "second");
      const env = await readFile(join(dir, ".env"), "utf8");
      const hits = env.split("\n").filter((l) => l.startsWith("FORWARDING_SECRET="));
      expect(hits).toEqual(["FORWARDING_SECRET=second"]);
    });
  });

  test("keeps unrelated .env lines", async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, ".env"), "ENTRY_PORT=25577\nFORWARDING_SECRET=old\n");
      await writeSecret(dir, "new");
      const env = await readFile(join(dir, ".env"), "utf8");
      expect(env).toContain("ENTRY_PORT=25577");
      expect(env).toContain("FORWARDING_SECRET=new");
      expect(env).not.toContain("old");
    });
  });

  test("creates proxy/ if it does not exist yet", async () => {
    await withTempDir(async (dir) => {
      await writeSecret(dir, "abc");
      expect(await readSecret(dir)).toBe("abc");
    });
  });
});

describe("ensureSecret", () => {
  test("creates one when missing", async () => {
    await withTempDir(async (dir) => {
      const [secret, created] = await ensureSecret(dir);
      expect(created).toBe(true);
      expect(secret.length).toBeGreaterThan(0);
    });
  });

  test("is idempotent — apply must not rotate by accident", async () => {
    await withTempDir(async (dir) => {
      const [first] = await ensureSecret(dir);
      const [second, created] = await ensureSecret(dir);
      expect(created).toBe(false);
      expect(second).toBe(first);
    });
  });

  test("returns null from readSecret when there is nothing to read", async () => {
    await withTempDir(async (dir) => {
      expect(await readSecret(dir)).toBeNull();
    });
  });
});

describe("rotateSecret", () => {
  test("replaces both copies together", async () => {
    await withTempDir(async (dir) => {
      const [before] = await ensureSecret(dir);
      const after = await rotateSecret(dir);
      expect(after).not.toBe(before);
      expect(await readSecret(dir)).toBe(after);
      const env = await readFile(join(dir, ".env"), "utf8");
      expect(env).toContain(`FORWARDING_SECRET=${after}`);
      expect(env).not.toContain(before);
    });
  });
});
