import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isOnWindowsDrive, platformNotes, restrictToOwner, sym } from "../src/platform.ts";
import { withTempDir } from "./helpers.ts";

describe("isOnWindowsDrive", () => {
  test("only ever true under WSL", () => {
    // On a non-WSL machine every path is false, including ones that look
    // like mounts. The check exists to warn about the /mnt bridge, and a
    // false positive would nag Linux users forever.
    if (process.platform !== "linux") {
      expect(isOnWindowsDrive("/mnt/c/Users/x")).toBe(false);
    }
  });

  test("is not fooled by paths that merely start with /mnt", () => {
    expect(isOnWindowsDrive("/mnternal/project")).toBe(false);
  });
});

describe("sym", () => {
  test("every symbol is a single printable character", () => {
    for (const s of Object.values(sym)) {
      expect(s.length).toBe(1);
      expect(s.trim()).toBe(s);
    }
  });

  test("has an entry for each thing the UI draws", () => {
    expect(Object.keys(sym).sort()).toEqual(["arrow", "bullet", "fail", "ok", "warn"]);
  });
});

describe("platformNotes", () => {
  test("returns advice, never throws, for any path", () => {
    for (const p of ["/mnt/c/x", "C:\\Users\\x", "/home/x", ""]) {
      expect(Array.isArray(platformNotes(p))).toBe(true);
    }
  });

  test("notes are advice, not errors — each is a full sentence", () => {
    for (const note of platformNotes("/mnt/c/project")) {
      expect(note.length).toBeGreaterThan(10);
    }
  });
});

describe("restrictToOwner", () => {
  test("leaves the file readable by us afterwards", async () => {
    // chmod on Windows only toggles the read-only bit, so this falls back to
    // icacls. Either way the owner must still be able to read the secret.
    await withTempDir(async (dir) => {
      const path = join(dir, "secret");
      await Bun.write(path, "abc");
      await restrictToOwner(path);
      expect(await readFile(path, "utf8")).toBe("abc");
    });
  });

  test("reports failure instead of throwing", async () => {
    const result = await restrictToOwner(
      join("does", "not", "exist", "anywhere"),
    ).catch(() => "threw");
    expect(result).not.toBe("threw");
  });
});
