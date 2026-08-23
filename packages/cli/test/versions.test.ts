import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchPaperVersions, isValidVersion, latestVersion } from "../src/versions.ts";

/**
 * These tests must never touch the network: CI runs offline-ish and a flaky
 * upstream is not a reason for a red build. Fetch is stubbed to fail, which
 * also exercises the path that matters most — the tool has to work with no
 * internet, and grounding the model against a stale list beats letting it
 * invent version numbers.
 *
 * The module caches its result, so the whole file shares one stubbed fetch.
 */
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("offline fallback", () => {
  test("returns a usable list instead of failing", async () => {
    const versions = await fetchPaperVersions();
    expect(versions.length).toBeGreaterThan(0);
  });

  test("every fallback version satisfies the schema's format", async () => {
    // A fallback entry the schema rejects would make `cloud init --manual`
    // suggest a default it then refuses to accept.
    for (const v of await fetchPaperVersions()) {
      expect(v).toMatch(/^\d+\.\d+(\.\d+)?$/);
    }
  });

  test("newest first", async () => {
    const [first] = await fetchPaperVersions();
    expect(await latestVersion()).toBe(first);
  });

  test("validates membership rather than shape", async () => {
    expect(await isValidVersion(await latestVersion())).toBe(true);
    expect(await isValidVersion("1.99.9")).toBe(false);
    expect(await isValidVersion("latest")).toBe(false);
  });
});
