import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createHostDirs,
  emptyTemplates,
  generatedFiles,
  plan,
  renderDiff,
  summarise,
  writeChanges,
} from "../src/plan.ts";
import { config, withTempDir } from "./helpers.ts";

describe("generatedFiles", () => {
  test("velocity networks generate velocity.toml and no config.yml", () => {
    const files = Object.keys(generatedFiles(config()));
    expect(files).toContain("proxy/velocity.toml");
    expect(files).not.toContain("proxy/config.yml");
  });

  test("bungeecord networks generate config.yml and no velocity.toml", () => {
    const files = Object.keys(
      generatedFiles(
        config({
          network: { name: "test", forwarding: "legacy" },
          proxy: { software: "bungeecord" },
        }),
      ),
    );
    expect(files).toContain("proxy/config.yml");
    expect(files).not.toContain("proxy/velocity.toml");
  });

  test("every generated file says so in its first line", () => {
    for (const [name, body] of Object.entries(generatedFiles(config()))) {
      if (name.endsWith(".json")) continue; // JSON has nowhere to put a comment
      expect(body.split("\n")[0]).toContain("GENERATED");
    }
  });

  test("patches are generated for every forwarding mode the schema allows", () => {
    for (const mode of ["modern", "bungeeguard", "legacy"] as const) {
      const cfg = config({
        network: { name: "test", forwarding: mode },
        proxy: { software: mode === "modern" ? "velocity" : "bungeecord" },
      });
      const files = Object.keys(generatedFiles(cfg));
      expect(files).toContain("proxy/patches/paper-global.json");
      expect(files).toContain("proxy/patches/spigot.json");
    }
  });
});

describe("plan", () => {
  test("reports every file as new in an empty directory", async () => {
    await withTempDir(async (dir) => {
      const changes = await plan(dir, config());
      expect(changes.length).toBe(Object.keys(generatedFiles(config())).length);
      expect(changes.every((c) => c.prev === null)).toBe(true);
    });
  });

  test("reports nothing once the files are written", async () => {
    await withTempDir(async (dir) => {
      const cfg = config();
      await writeChanges(dir, await plan(dir, cfg));
      expect(await plan(dir, cfg)).toEqual([]);
    });
  });

  test("detects a hand-edit of a generated file", async () => {
    await withTempDir(async (dir) => {
      const cfg = config();
      await writeChanges(dir, await plan(dir, cfg));
      await writeFile(join(dir, "docker-compose.yml"), "tampered\n", "utf8");
      const changes = await plan(dir, cfg);
      expect(changes.map((c) => c.path)).toEqual(["docker-compose.yml"]);
      expect(changes[0].prev).toBe("tampered\n");
    });
  });

  test("detects a config change", async () => {
    await withTempDir(async (dir) => {
      await writeChanges(dir, await plan(dir, config()));
      const changed = config({ network: { name: "test", motd: "different" } });
      const paths = (await plan(dir, changed)).map((c) => c.path);
      expect(paths).toContain("docker-compose.yml");
    });
  });
});

describe("writeChanges", () => {
  test("creates parent directories", async () => {
    await withTempDir(async (dir) => {
      await writeChanges(dir, await plan(dir, config()));
      const patch = await readFile(join(dir, "proxy/patches/spigot.json"), "utf8");
      expect(patch).toContain("bungeecord");
    });
  });

  test("writes exactly what the renderer produced", async () => {
    await withTempDir(async (dir) => {
      const cfg = config();
      await writeChanges(dir, await plan(dir, cfg));
      for (const [rel, body] of Object.entries(generatedFiles(cfg))) {
        expect(await readFile(join(dir, rel), "utf8")).toBe(body);
      }
    });
  });

  test("leaves files it was not asked to change alone", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "proxy"), { recursive: true });
      await writeFile(join(dir, "proxy/forwarding.secret"), "keepme", "utf8");
      await writeChanges(dir, await plan(dir, config()));
      expect(await readFile(join(dir, "proxy/forwarding.secret"), "utf8")).toBe("keepme");
    });
  });
});

describe("createHostDirs", () => {
  test("creates the plugin directory for every server, proxy included", async () => {
    await withTempDir(async (dir) => {
      const cfg = config({
        network: { name: "test", storage: "volume" },
        groups: {
          lobby: { version: "1.21.10", fallback: true, min: 2 },
          smp: { version: "1.21.10", static: true },
        },
      });
      await createHostDirs(dir, cfg);
      for (const d of ["proxy", "lobby-1", "lobby-2", "smp"]) {
        expect(existsSync(join(dir, "data", d, "plugins"))).toBe(true);
      }
    });
  });

  test("creates the whole data directory for a bind-mounted group", async () => {
    await withTempDir(async (dir) => {
      const cfg = config({
        groups: {
          lobby: { version: "1.21.10", fallback: true },
          smp: { version: "1.21.10", static: true },
        },
      });
      await createHostDirs(dir, cfg);
      expect(existsSync(join(dir, "data", "smp"))).toBe(true);
      // Not data/smp/plugins: the server creates that inside its own /data.
      expect(existsSync(join(dir, "data", "smp", "plugins"))).toBe(false);
    });
  });

  test("is idempotent — apply runs it every time", async () => {
    await withTempDir(async (dir) => {
      await createHostDirs(dir, config());
      await createHostDirs(dir, config());
      expect(existsSync(join(dir, "data", "lobby", "plugins"))).toBe(true);
    });
  });

  test("does not disturb files already there", async () => {
    await withTempDir(async (dir) => {
      await createHostDirs(dir, config());
      const kept = join(dir, "data", "lobby", "plugins", "config.yml");
      await writeFile(kept, "mine", "utf8");
      await createHostDirs(dir, config());
      expect(await readFile(kept, "utf8")).toBe("mine");
    });
  });
});

describe("emptyTemplates", () => {
  const templated = config({
    groups: { lobby: { version: "1.21.10", fallback: true, template: "hub" } },
  });

  test("reports a template directory that does not exist", async () => {
    await withTempDir(async (dir) => {
      expect(await emptyTemplates(dir, templated)).toEqual(["hub"]);
    });
  });

  test("reports a template directory with nothing in it", async () => {
    await withTempDir(async (dir) => {
      await createHostDirs(dir, templated);
      expect(await emptyTemplates(dir, templated)).toEqual(["hub"]);
    });
  });

  test("says nothing once the template has files", async () => {
    await withTempDir(async (dir) => {
      await createHostDirs(dir, templated);
      await writeFile(join(dir, "templates", "hub", "server.properties"), "x", "utf8");
      expect(await emptyTemplates(dir, templated)).toEqual([]);
    });
  });

  test("groups without a template are never reported", async () => {
    await withTempDir(async (dir) => {
      expect(await emptyTemplates(dir, config())).toEqual([]);
    });
  });

  test("a template shared by two groups is reported once", async () => {
    const shared = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true, template: "hub" },
        hub2: { version: "1.21.10", template: "hub" },
      },
    });
    await withTempDir(async (dir) => {
      expect(await emptyTemplates(dir, shared)).toEqual(["hub"]);
    });
  });
});

describe("renderDiff", () => {
  test("summarises a new file by line count instead of dumping it", () => {
    const out = renderDiff({ path: "a.yml", next: "one\ntwo\nthree", prev: null });
    expect(out).toContain("a.yml");
    expect(out).toContain("3 lines");
    expect(out).not.toContain("two");
  });

  test("shows only the changed region, not the whole file", () => {
    const prev = ["a", "b", "c", "d"].join("\n");
    const next = ["a", "B", "c", "d"].join("\n");
    const out = renderDiff({ path: "a.yml", next, prev });
    expect(out).toContain("- b");
    expect(out).toContain("+ B");
    expect(out).not.toContain("- a");
    expect(out).not.toContain("+ d");
  });

  test("caps a huge diff instead of scrolling the terminal", () => {
    const prev = Array.from({ length: 200 }, (_, i) => `old ${i}`).join("\n");
    const next = Array.from({ length: 200 }, (_, i) => `new ${i}`).join("\n");
    const out = renderDiff({ path: "a.yml", next, prev });
    expect(out).toContain("more removed");
    expect(out).toContain("more added");
    expect(out.split("\n").length).toBeLessThan(100);
  });

  test("summarise says so when there is nothing to do", () => {
    expect(summarise("/root", [])).toContain("No changes");
  });
});
