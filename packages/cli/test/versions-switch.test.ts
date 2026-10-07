import { describe, expect, test } from "bun:test";
import { compareMcVersions, isMcVersion } from "@cloud/schema";
import { downgrades, withVersion } from "../src/version.ts";
import { bootPhase } from "../src/boot.ts";
import { networkName } from "../src/blueprint.ts";
import { config } from "./helpers.ts";

describe("compareMcVersions", () => {
  test("year-based versions are newer than 1.x", () => {
    expect(compareMcVersions("26.2", "1.21.10")).toBeGreaterThan(0);
    expect(compareMcVersions("1.21.10", "1.21.9")).toBeGreaterThan(0);
    expect(compareMcVersions("1.21", "1.21.0")).toBe(0);
    expect(compareMcVersions("1.20.6", "1.21")).toBeLessThan(0);
  });

  test("isMcVersion accepts versions and nothing else", () => {
    expect(isMcVersion("26.2")).toBe(true);
    expect(isMcVersion("1.21.10")).toBe(true);
    expect(isMcVersion("latest")).toBe(false);
    expect(isMcVersion("1.21.10-pre1")).toBe(false);
  });
});

describe("withVersion", () => {
  const cfg = config({
    groups: {
      lobby: { version: "1.21.10", fallback: true, min: 2 },
      survival: { version: "1.21.8", static: true },
    },
  });

  test("moves every group, and leaves the input alone", () => {
    const next = withVersion(cfg, "26.2");
    expect(Object.values(next.groups).map((g) => g.version)).toEqual(["26.2", "26.2"]);
    expect(cfg.groups.lobby.version).toBe("1.21.10");
  });

  test("downgrades names each group that would go back, and only those", () => {
    expect(downgrades(cfg, withVersion(cfg, "1.21.9"))).toEqual([
      { group: "lobby", from: "1.21.10", to: "1.21.9" },
    ]);
    expect(downgrades(cfg, withVersion(cfg, "26.2"))).toEqual([]);
  });
});

describe("bootPhase", () => {
  // Real lines, from the servers this was developed against.
  const paper = [
    "[mc-image-helper] 19:16:16.528 INFO  : Downloaded /data/paper-1.21.10-130.jar",
    "[mc-image-helper] 19:16:19.057 INFO  : Downloaded /data/plugins/ViaVersion-5.11.0.jar from https://hangar.papermc.io/api/v1/projects/ViaVersion/versions/5.11.0/PAPER/download",
    "Downloading mojang_1.21.10.jar",
    "Applying patches",
    "Starting org.bukkit.craftbukkit.Main",
    "[13:19:35 INFO]: [bootstrap] Loading Paper 1.21.10-130-ver/1.21.10@8043efd (2026-01-04T21:00:59Z) for Minecraft 1.21.10",
    "[13:19:40 INFO]: Preparing level \"world\"",
    "[13:19:41 INFO]: Preparing spawn area: 63%",
    "[13:25:27 INFO]: Done (27.471s)! For help, type \"help\"",
  ];

  test.each([
    [1, "downloading server"],
    [2, "installing plugins"],
    [4, "preparing server jar"],
    [6, "starting server"],
    [7, "generating world"],
    [8, "generating world 63%"],
    [9, "Done"],
  ])("a Paper log up to line %i reads as %s", (n, phase) => {
    expect(bootPhase(paper.slice(0, n as number))).toBe(phase as string);
  });

  test("Velocity, Fabric and NeoForge", () => {
    expect(bootPhase(["[20:10:38 INFO]: Booting up Velocity 3.5.1..."])).toBe("starting server");
    expect(bootPhase(["[20:10:38 INFO]: Done (0.51s)!"])).toBe("Done");
    expect(bootPhase(["[20:10:53] [main/INFO]: Loading 44 mods:", "\t- fabric-api 0.138.4+1.21.10"])).toBe("loading mods");
    expect(bootPhase(["[mc-image-helper] 20:10:36.432 INFO  : Downloaded /data/mods/FabricProxy-Lite-2.11.0.jar"])).toBe("installing plugins");
  });

  test("a log with nothing recognisable yet is a container starting", () => {
    expect(bootPhase([])).toBe("starting container");
    expect(bootPhase(["[init] Running as uid=1000 gid=1000"])).toBe("starting container");
  });
});

describe("networkName", () => {
  test("a version becomes part of the name, so two networks do not share containers", () => {
    expect(networkName("mynetwork", "26.2")).toBe("mynetwork-26-2");
    expect(networkName("mynetwork")).toBe("mynetwork");
  });

  test("stays within the 32 characters a name may have", () => {
    const n = networkName("a-very-long-network-name-indeed-x", "1.21.10");
    expect(n.length).toBeLessThanOrEqual(32);
    expect(n.endsWith("-1-21-10")).toBe(true);
    expect(n).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
