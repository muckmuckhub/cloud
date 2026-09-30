import { describe, expect, test } from "bun:test";
import { CloudConfigSchema } from "@cloud/schema";
import { PRESETS } from "../src/presets/registry.ts";
import { applyPreset, PresetError, type Preset } from "../src/presets/types.ts";
import { config } from "./helpers.ts";

describe("every registered preset", () => {
  const base = config();

  test.each(Object.keys(PRESETS))("%s produces a valid config", (name) => {
    const merged = applyPreset(base, PRESETS[name]);
    expect(CloudConfigSchema.safeParse(merged).success).toBe(true);
  });

  test.each(Object.keys(PRESETS))("%s does not mutate its input", (name) => {
    const snapshot = JSON.stringify(base);
    applyPreset(base, PRESETS[name]);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  test.each(Object.keys(PRESETS))("%s is described and documented", (name) => {
    const preset = PRESETS[name];
    expect(preset.description.length).toBeGreaterThan(0);
    // A preset that installs jars must say where they come from.
    const refs = [
      ...(preset.proxyModrinth ?? []),
      ...(preset.proxyHangar ?? []),
      ...(preset.allGroupModrinth ?? []),
      ...(preset.allGroupHangar ?? []),
    ];
    if (preset.proxyPlugins?.length || preset.allGroupPlugins?.length || refs.length) {
      expect(preset.docs).toBeTruthy();
    }
  });

  test.each(Object.keys(PRESETS))("%s uses official https download URLs", (name) => {
    const preset = PRESETS[name];
    for (const url of [...(preset.proxyPlugins ?? []), ...(preset.allGroupPlugins ?? [])]) {
      expect(url).toStartWith("https://");
    }
  });

  test.each(Object.keys(PRESETS))("%s links to downloads, not to a page", (name) => {
    // Two presets once shipped URLs that redirected to a project homepage.
    // The downloader wrote the HTML page where a jar belonged and the server
    // crash-looped. This is the offline half of the check; `bun run links`
    // does the real one against the network.
    const preset = PRESETS[name];
    for (const url of [...(preset.proxyPlugins ?? []), ...(preset.allGroupPlugins ?? [])]) {
      expect(url).not.toBe(preset.docs);
      expect(new URL(url).pathname).not.toBe("/");
      expect(url).not.toContain("/wiki/");
    }
  });
});

describe("idempotency", () => {
  // `cloud add geyser` run twice must not duplicate plugin URLs or ports.
  const repeatable = Object.entries(PRESETS).filter(([, p]) => !p.groups);

  test.each(repeatable.map(([n]) => n))("%s applies twice with no change", (name) => {
    const once = CloudConfigSchema.parse(applyPreset(config(), PRESETS[name]));
    const twice = applyPreset(once, PRESETS[name]);
    expect(twice).toEqual(once);
  });

  test("a preset adding a group refuses the second time", () => {
    const once = CloudConfigSchema.parse(applyPreset(config(), PRESETS.creative));
    expect(() => applyPreset(once, PRESETS.creative)).toThrow(PresetError);
  });
});

describe("merge rules", () => {
  const preset: Preset = {
    name: "test",
    description: "fixture",
    proxyPlugins: ["https://example.com/proxy.jar"],
    allGroupPlugins: ["https://example.com/server.jar"],
    allGroupEnv: { SPAWN_PROTECTION: "0", MODE: "preset" },
    proxyEnv: { GEYSER_DEBUG: "true" },
    proxyPorts: ["19132:19132/udp"],
  };

  test("plugins are appended to the proxy and every group", () => {
    const out = applyPreset(
      config({
        groups: {
          lobby: { version: "1.21.10", fallback: true },
          smp: { version: "1.21.10", static: true },
        },
      }),
      preset,
    );
    expect(out.proxy.plugins).toEqual(["https://example.com/proxy.jar"]);
    expect(out.groups.lobby.plugins).toEqual(["https://example.com/server.jar"]);
    expect(out.groups.smp.plugins).toEqual(["https://example.com/server.jar"]);
  });

  test("existing plugins survive and are not duplicated", () => {
    const start = config({
      proxy: { plugins: ["https://example.com/proxy.jar"] },
    });
    const out = applyPreset(start, preset);
    expect(out.proxy.plugins).toEqual(["https://example.com/proxy.jar"]);
  });

  test("proxy ports are merged without duplicates", () => {
    const out = applyPreset(config({ proxy: { ports: ["19132:19132/udp"] } }), preset);
    expect(out.proxy.ports).toEqual(["19132:19132/udp"]);
  });

  test("a hand-set value always wins over the preset's", () => {
    // A preset must never silently change something the user typed.
    const start = config({
      proxy: { env: { GEYSER_DEBUG: "false" } },
      groups: {
        lobby: { version: "1.21.10", fallback: true, env: { MODE: "mine" } },
      },
    });
    const out = applyPreset(start, preset);
    expect(out.proxy.env.GEYSER_DEBUG).toBe("false");
    expect(out.groups.lobby.env.MODE).toBe("mine");
    // ...while values the user did not set still arrive.
    expect(out.groups.lobby.env.SPAWN_PROTECTION).toBe("0");
  });

  test("a new group inherits the Minecraft version already in use", () => {
    const out = applyPreset(
      config({ groups: { lobby: { version: "1.20.4", fallback: true } } }),
      { name: "x", description: "x", groups: { creative: { memory: "1G" } } },
    );
    expect(out.groups.creative.version).toBe("1.20.4");
    expect(out.groups.creative.memory).toBe("1G");
  });

  test("a group name collision is refused by name, not silently merged", () => {
    const collide: Preset = {
      name: "x",
      description: "x",
      groups: { lobby: { memory: "1G" } },
    };
    expect(() => applyPreset(config(), collide)).toThrow(/lobby/);
  });

  test("a preset cannot take over the fallback role", () => {
    // Two fallbacks is a validation error, which is the point: the preset
    // gets no privileges, it just fails the same way a bad edit would.
    const greedy: Preset = {
      name: "x",
      description: "x",
      groups: { hub: { fallback: true } },
    };
    const merged = applyPreset(config(), greedy);
    expect(CloudConfigSchema.safeParse(merged).success).toBe(false);
  });
});

describe("geyser", () => {
  test("publishes Bedrock's UDP port on the proxy", () => {
    const out = applyPreset(config(), PRESETS.geyser);
    expect(out.proxy.ports).toContain("19132:19132/udp");
  });

  test("no longer tells the user to hand-edit the compose file", () => {
    expect(PRESETS.geyser.notes?.join(" ")).not.toContain("docker-compose.yml");
  });
});

describe("plugin references in presets", () => {
  const preset: Preset = {
    name: "refs",
    description: "fixture",
    proxyModrinth: ["a:1"],
    proxyHangar: ["B:2"],
    allGroupModrinth: ["c:3"],
    allGroupHangar: ["D:4"],
  };

  test("are merged into the proxy and every group", () => {
    const out = applyPreset(config(), preset);
    expect(out.proxy.modrinth).toEqual(["a:1"]);
    expect(out.proxy.hangar).toEqual(["B:2"]);
    expect(out.groups.lobby.modrinth).toEqual(["c:3"]);
    expect(out.groups.lobby.hangar).toEqual(["D:4"]);
  });

  test("apply twice with no duplicates", () => {
    const once = CloudConfigSchema.parse(applyPreset(config(), preset));
    expect(applyPreset(once, preset)).toEqual(once);
  });

  test("a group added by a preset still validates with no references", () => {
    const out = applyPreset(config(), {
      name: "x",
      description: "x",
      groups: { extra: {} },
    });
    expect(out.groups.extra.modrinth).toEqual([]);
    expect(CloudConfigSchema.safeParse(out).success).toBe(true);
  });
});
