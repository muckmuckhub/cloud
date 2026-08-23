import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { overrideFile, portWarnings } from "../src/overrides.ts";
import type { PublishedPort } from "../src/docker.ts";
import { config, withTempDir } from "./helpers.ts";

function port(over: Partial<PublishedPort>): PublishedPort {
  return { service: "db", published: "3306", protocol: "tcp", hostIp: "", ...over };
}

const cfg = config({
  groups: {
    lobby: { version: "1.21.10", fallback: true, min: 2 },
    smp: { version: "1.21.10", static: true },
  },
});

describe("overrideFile", () => {
  test("finds nothing when there is no override", async () => {
    await withTempDir(async (dir) => {
      expect(overrideFile(dir)).toBeNull();
    });
  });

  test.each([
    "compose.override.yaml",
    "compose.override.yml",
    "docker-compose.override.yaml",
    "docker-compose.override.yml",
  ])("recognises %s", async (name) => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, name), "services: {}\n", "utf8");
      expect(overrideFile(dir)).toBe(name);
    });
  });

  test("prefers compose.override.yaml, as Compose does", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "docker-compose.override.yml"), "services: {}\n", "utf8");
      await writeFile(join(dir, "compose.override.yaml"), "services: {}\n", "utf8");
      expect(overrideFile(dir)).toBe("compose.override.yaml");
    });
  });
});

describe("portWarnings", () => {
  test("says nothing about the proxy — publishing is its job", () => {
    expect(portWarnings(cfg, [port({ service: "proxy", published: "25565" })])).toEqual(
      [],
    );
  });

  test("says nothing when a port is bound to localhost", () => {
    // Publishing a Grafana on 127.0.0.1 is a perfectly good reason to publish.
    for (const hostIp of ["127.0.0.1", "::1", "192.168.1.5"]) {
      expect(portWarnings(cfg, [port({ hostIp })])).toEqual([]);
    }
  });

  test("warns about any service published on every interface", () => {
    for (const hostIp of ["", "0.0.0.0", "::"]) {
      const [w] = portWarnings(cfg, [port({ hostIp })]);
      expect(w.service).toBe("db");
      expect(w.isBackend).toBe(false);
      expect(w.message).toContain("every interface");
    }
  });

  test("a published backend gets the security warning, not the mild one", () => {
    // This is the one that matters: a reachable backend means anyone can join
    // it directly and claim any UUID.
    const [w] = portWarnings(cfg, [port({ service: "lobby-2", published: "25565" })]);
    expect(w.isBackend).toBe(true);
    expect(w.message).toContain("online-mode=false");
    expect(w.message).toContain("including an operator");
  });

  test("every instance of a group counts as a backend", () => {
    for (const service of ["lobby-1", "lobby-2", "smp"]) {
      expect(portWarnings(cfg, [port({ service })])[0].isBackend).toBe(true);
    }
  });

  test("reports each offending port, not just the first", () => {
    const warnings = portWarnings(cfg, [
      port({ service: "db" }),
      port({ service: "lobby-1", published: "25565" }),
      port({ service: "grafana", published: "3000" }),
    ]);
    expect(warnings.map((w) => w.service)).toEqual(["db", "lobby-1", "grafana"]);
  });

  test("names the protocol, so a UDP publish is not mistaken for TCP", () => {
    const [w] = portWarnings(cfg, [port({ published: "19132", protocol: "udp" })]);
    expect(w.port).toBe("19132/udp");
  });

  test("nothing published means nothing to say", () => {
    expect(portWarnings(cfg, [])).toEqual([]);
  });
});
