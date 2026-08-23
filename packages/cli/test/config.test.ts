import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError, findRoot, loadConfig, saveConfig } from "../src/config.ts";
import { renderCloudToml } from "../src/render/config.ts";
import { config, withTempDir } from "./helpers.ts";

const MINIMAL = `
[network]
name = "test"

[groups.lobby]
version = "1.21.10"
fallback = true
`;

describe("findRoot", () => {
  test("finds cloud.toml in the directory itself", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "cloud.toml"), MINIMAL);
      expect(findRoot(dir)).toBe(dir);
    });
  });

  test("walks up from a subdirectory, like git finds .git", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "cloud.toml"), MINIMAL);
      const deep = join(dir, "a", "b", "c");
      await mkdir(deep, { recursive: true });
      expect(findRoot(deep)).toBe(dir);
    });
  });

  test("returns null instead of looping at the filesystem root", async () => {
    // dirname, not join(dir, ".."): the latter never reaches a fixpoint on
    // Windows drive roots or UNC shares, and this test hangs forever.
    await withTempDir(async (dir) => {
      const deep = join(dir, "x", "y");
      await mkdir(deep, { recursive: true });
      expect(findRoot(deep)).toBeNull();
    });
  });
});

describe("loadConfig", () => {
  test("parses and applies defaults", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "cloud.toml"), MINIMAL);
      const cfg = await loadConfig(dir);
      expect(cfg.network.name).toBe("test");
      expect(cfg.network.entry_port).toBe(25565);
    });
  });

  test("reports malformed TOML as a config error", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "cloud.toml"), "[network\nname = ");
      expect(loadConfig(dir)).rejects.toThrow(ConfigError);
      expect(loadConfig(dir)).rejects.toThrow("not valid TOML");
    });
  });

  test("reports every validation issue with its path", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "cloud.toml"),
        `[network]\nname = "Bad Name"\n\n[groups.lobby]\nversion = "1.21.10"\n`,
      );
      try {
        await loadConfig(dir);
        throw new Error("expected loadConfig to reject");
      } catch (err) {
        const msg = (err as Error).message;
        expect(err).toBeInstanceOf(ConfigError);
        expect(msg).toContain("network.name");
        expect(msg).toContain("groups");
      }
    });
  });
});

describe("renderCloudToml", () => {
  test("round-trips through the parser back to the same config", async () => {
    // If a field renders but does not parse back, `cloud ask` and `cloud add`
    // silently drop it — they rewrite the whole file from a parsed config.
    const cfg = config({
      network: {
        name: "test",
        entry_port: 25577,
        motd: "Hello \"world\"",
        domain: "play.example.com",
        storage: "volume",
        online: false,
      },
      proxy: {
        software: "velocity",
        memory: "1G",
        java: 25,
        plugins: ["https://example.com/a.jar"],
        ports: ["19132:19132/udp"],
        env: { GEYSER_DEBUG: "true" },
      },
      groups: {
        lobby: {
          version: "1.21.10",
          fallback: true,
          min: 2,
          plugins: ["https://example.com/b.jar"],
          env: { MODE: "adventure" },
        },
        smp: { version: "1.20.4", static: true, template: "seed", java: 17 },
      },
    });

    await withTempDir(async (dir) => {
      await saveConfig(dir, renderCloudToml(cfg));
      expect(await loadConfig(dir)).toEqual(cfg);
    });
  });

  test("round-trips a minimal config", async () => {
    const cfg = config();
    await withTempDir(async (dir) => {
      await saveConfig(dir, renderCloudToml(cfg));
      expect(await loadConfig(dir)).toEqual(cfg);
    });
  });

  test("omits optional fields that are unset", () => {
    const out = renderCloudToml(config());
    expect(out).not.toContain("domain");
    expect(out).not.toContain("template");
    expect(out).not.toContain("ports");
    expect(out).not.toContain("[proxy.env]");
  });

  test("is stable — rendering the same config twice is byte-identical", () => {
    const cfg = config({ proxy: { ports: ["19132:19132/udp"] } });
    expect(renderCloudToml(cfg)).toBe(renderCloudToml(cfg));
  });
});
