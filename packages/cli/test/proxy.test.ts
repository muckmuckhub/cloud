import { describe, expect, test } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  renderBungeeConfig,
  renderNeoForgePatches,
  renderPaperPatches,
  renderVelocityToml,
} from "../src/render/proxy.ts";
import { proxyConfigFile, wiringFor } from "../src/render/forwarding.ts";
import { config } from "./helpers.ts";

const twoGroups = {
  groups: {
    lobby: { version: "1.21.10", fallback: true, min: 2 },
    smp: { version: "1.21.10", static: true },
  },
};

describe("velocity.toml", () => {
  test("is valid TOML", () => {
    expect(() => parseToml(renderVelocityToml(config()))).not.toThrow();
  });

  /**
   * `try` lives inside the [servers] table — that is Velocity's format, not an
   * accident of rendering, so it is separated out before comparing servers.
   */
  function velocityServers(cfg: Parameters<typeof renderVelocityToml>[0]): {
    servers: Record<string, string>;
    try: string[];
  } {
    const doc = parseToml(renderVelocityToml(cfg)) as {
      servers: Record<string, string | string[]>;
    };
    const { try: tryList, ...servers } = doc.servers;
    return { servers: servers as Record<string, string>, try: tryList as string[] };
  }

  test("registers every instance by container name", () => {
    expect(velocityServers(config(twoGroups)).servers).toEqual({
      "lobby-1": "test-lobby-1:25565",
      "lobby-2": "test-lobby-2:25565",
      smp: "test-smp:25565",
    });
  });

  test("try[] lists every instance of the fallback group", () => {
    // Not just the first: with one entry, restarting that entry disconnects
    // the players the failover list exists to catch.
    expect(velocityServers(config(twoGroups)).try).toEqual(["lobby-1", "lobby-2"]);
  });

  test("try[] never includes a non-fallback group", () => {
    // A player bounced out of a lobby should not land in survival.
    expect(velocityServers(config(twoGroups)).try).not.toContain("smp");
  });

  test("try[] is a single entry when the group runs one instance", () => {
    expect(velocityServers(config()).try).toEqual(["lobby"]);
  });

  test("binds 25565 internally regardless of the entry port", () => {
    const doc = parseToml(
      renderVelocityToml(config({ network: { name: "test", entry_port: 25599 } })),
    ) as { bind: string };
    expect(doc.bind).toBe("0.0.0.0:25565");
  });

  test("online-mode follows the network setting", () => {
    const off = parseToml(
      renderVelocityToml(config({ network: { name: "test", online: false } })),
    ) as { "online-mode": boolean };
    expect(off["online-mode"]).toBe(false);
  });

  test("names a secret file under modern forwarding", () => {
    const doc = parseToml(renderVelocityToml(config())) as Record<string, unknown>;
    expect(doc["player-info-forwarding-mode"]).toBe("modern");
    expect(doc["forwarding-secret-file"]).toBe("forwarding.secret");
  });

  test("names no secret file under legacy forwarding", () => {
    const doc = parseToml(
      renderVelocityToml(config({ network: { name: "test", forwarding: "legacy" } })),
    ) as Record<string, unknown>;
    expect(doc["player-info-forwarding-mode"]).toBe("legacy");
    expect(doc["forwarding-secret-file"]).toBeUndefined();
  });

  test("bungeeguard keeps the secret file — the token lives there", () => {
    const doc = parseToml(
      renderVelocityToml(
        config({ network: { name: "test", forwarding: "bungeeguard" } }),
      ),
    ) as Record<string, unknown>;
    expect(doc["forwarding-secret-file"]).toBe("forwarding.secret");
  });

  test("is marked generated", () => {
    expect(renderVelocityToml(config())).toStartWith("# GENERATED");
  });
});

describe("bungeecord config.yml", () => {
  const bungee = (over: Record<string, unknown> = {}) =>
    config({
      network: { name: "test", forwarding: "legacy" },
      proxy: { software: "bungeecord" },
      ...over,
    });

  test("is valid YAML", () => {
    expect(() => parseYaml(renderBungeeConfig(bungee()))).not.toThrow();
  });

  test("registers every instance by container name", () => {
    const doc = parseYaml(renderBungeeConfig(bungee(twoGroups))) as {
      servers: Record<string, { address: string }>;
    };
    expect(Object.keys(doc.servers)).toEqual(["lobby-1", "lobby-2", "smp"]);
    expect(doc.servers["lobby-2"].address).toBe("test-lobby-2:25565");
  });

  test("priorities list every instance of the fallback group", () => {
    const doc = parseYaml(renderBungeeConfig(bungee(twoGroups))) as {
      listeners: { priorities: string[] }[];
    };
    expect(doc.listeners[0].priorities).toEqual(["lobby-1", "lobby-2"]);
    expect(doc.listeners[0].priorities).not.toContain("smp");
  });

  test("ip_forward is on — it is BungeeCord's forwarding switch", () => {
    const doc = parseYaml(renderBungeeConfig(bungee())) as { ip_forward: boolean };
    expect(doc.ip_forward).toBe(true);
  });

  test("online_mode follows the network setting", () => {
    const doc = parseYaml(
      renderBungeeConfig(bungee({ network: { name: "test", forwarding: "legacy", online: false } })),
    ) as { online_mode: boolean };
    expect(doc.online_mode).toBe(false);
  });

  test("binds 25565 internally", () => {
    const doc = parseYaml(renderBungeeConfig(bungee())) as {
      listeners: { host: string }[];
    };
    expect(doc.listeners[0].host).toBe("0.0.0.0:25565");
  });

  test("says what is still manual under bungeeguard", () => {
    const withToken = renderBungeeConfig(
      config({
        network: { name: "test", forwarding: "bungeeguard" },
        proxy: { software: "bungeecord" },
      }),
    );
    expect(withToken).toContain("BungeeGuard");
    expect(renderBungeeConfig(bungee())).not.toContain("BungeeGuard");
  });

  test("is marked generated", () => {
    expect(renderBungeeConfig(bungee())).toStartWith("# GENERATED");
  });
});

describe("proxyConfigFile", () => {
  test("velocity reads velocity.toml, everything else reads config.yml", () => {
    expect(proxyConfigFile("velocity")).toBe("proxy/velocity.toml");
    expect(proxyConfigFile("bungeecord")).toBe("proxy/config.yml");
    expect(proxyConfigFile("waterfall")).toBe("proxy/config.yml");
  });
});

describe("paper patches", () => {
  /** Flattens a patch set into path -> value for easy assertions. */
  function ops(body: string): Record<string, unknown> {
    const doc = JSON.parse(body) as {
      ops: { $set: { path: string; value: unknown } }[];
    };
    return Object.fromEntries(doc.ops.map((o) => [o.$set.path, o.$set.value]));
  }

  test("each file is one patch set with no array wrapper", () => {
    // A {"patches": [...]} shape is rejected at container start.
    for (const body of Object.values(renderPaperPatches(config()))) {
      const doc = JSON.parse(body) as Record<string, unknown>;
      expect(Object.keys(doc).every((k) => ["file", "ops", "file-format"].includes(k)))
        .toBe(true);
      expect(doc.patches).toBeUndefined();
    }
  });

  test("one target file per definition file", () => {
    const files = renderPaperPatches(config());
    const targets = Object.values(files).map(
      (b) => (JSON.parse(b) as { file: string }).file,
    );
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets.sort()).toEqual(["/data/config/paper-global.yml", "/data/spigot.yml"]);
  });

  test("modern forwarding turns velocity on and bungee off", () => {
    const files = renderPaperPatches(config());
    expect(ops(files["paper-global.json"])["$.proxies.velocity.enabled"]).toBe(
      "${CFG_VELOCITY_ENABLED}",
    );
    expect(ops(files["spigot.json"])["$.settings.bungeecord"]).toBe(
      "${CFG_BUNGEE_ENABLED}",
    );
  });

  test("the secret is patched in only under modern forwarding", () => {
    const modern = renderPaperPatches(config());
    expect(ops(modern["paper-global.json"])["$.proxies.velocity.secret"]).toBe(
      "${CFG_FORWARDING_SECRET}",
    );

    const guard = renderPaperPatches(
      config({
        network: { name: "test", forwarding: "bungeeguard" },
        proxy: { software: "bungeecord" },
      }),
    );
    // Under bungeeguard the token belongs to the plugin, not to Paper.
    expect(ops(guard["paper-global.json"])["$.proxies.velocity.secret"]).toBeUndefined();
  });

  test("legacy forwarding still patches both files", () => {
    const files = renderPaperPatches(
      config({
        network: { name: "test", forwarding: "legacy" },
        proxy: { software: "bungeecord" },
      }),
    );
    expect(Object.keys(files).sort()).toEqual(["paper-global.json", "spigot.json"]);
    expect(ops(files["paper-global.json"])["$.proxies.bungee-cord.online-mode"]).toBe(
      "${CFG_BUNGEE_ONLINE_MODE}",
    );
  });

  test("booleans are typed, or the YAML gets a string", () => {
    for (const body of Object.values(renderPaperPatches(config()))) {
      const doc = JSON.parse(body) as {
        ops: { $set: { path: string; "value-type"?: string } }[];
      };
      for (const op of doc.ops) {
        if (op.$set.path.endsWith("secret")) continue;
        expect(op.$set["value-type"]).toBe("bool");
      }
    }
  });
});

describe("forwarding wiring", () => {
  test("modern and legacy are mutually exclusive in every mode", () => {
    for (const mode of ["modern", "legacy", "bungeeguard"] as const) {
      const w = wiringFor(mode);
      expect(w.velocityEnabled && w.bungeeEnabled).toBe(false);
      expect(w.velocityEnabled || w.bungeeEnabled).toBe(true);
    }
  });

  test("only legacy runs without a secret", () => {
    expect(wiringFor("modern").usesSecret).toBe(true);
    expect(wiringFor("bungeeguard").usesSecret).toBe(true);
    expect(wiringFor("legacy").usesSecret).toBe(false);
  });
});

describe("bungeeguard patch", () => {
  const cfg = config({ network: { name: "test", forwarding: "bungeeguard" } });

  test("sets allowed-tokens to the secret as a one-element list", () => {
    const patch = JSON.parse(renderPaperPatches(cfg)["bungeeguard.json"]);
    expect(patch.file).toBe("/data/plugins/BungeeGuard/config.yml");
    expect(Object.keys(patch).sort()).toEqual(["file", "ops"]);
    expect(patch.ops[0].$put).toEqual({
      path: "$",
      key: "allowed-tokens",
      value: "${CFG_FORWARDING_SECRET}",
      "value-type": "list of string",
    });
  });

  test("exists only under bungeeguard", () => {
    expect(renderPaperPatches(config())["bungeeguard.json"]).toBeUndefined();
  });

  test("the proxy config says where the token lives, instead of asking for it by hand", () => {
    const out = renderBungeeConfig(
      config({
        network: { name: "test", forwarding: "bungeeguard" },
        proxy: { software: "bungeecord" },
      }),
    );
    expect(out).toContain("installed on the proxy and every");
    expect(out).not.toContain("put the token");
  });
});

describe("neoforge patch", () => {
  const neo = (forwarding: string) =>
    config({
      network: { name: "test", forwarding },
      proxy: forwarding === "modern" ? {} : { software: "bungeecord" },
      groups: {
        lobby: { version: "1.21.10", fallback: true },
        modded: { software: "neoforge", version: "1.21.1" },
      },
    });
  const ops = (forwarding: string) =>
    JSON.parse(renderNeoForgePatches(neo(forwarding))["proxy-compatible-forge.json"]).ops.map(
      (o: { $put: { key: string; value: string } }) => [o.$put.key, o.$put.value],
    );

  test("follows the network's forwarding mode", () => {
    expect(ops("modern")).toContainEqual(["mode", "MODERN"]);
    expect(ops("bungeeguard")).toContainEqual(["mode", "BUNGEEGUARD"]);
    expect(ops("legacy")).toContainEqual(["mode", "LEGACY"]);
  });

  test("patches the secret only when the mode has one", () => {
    expect(ops("modern")).toContainEqual(["secret", "${CFG_FORWARDING_SECRET}"]);
    expect(ops("legacy").map((o: string[]) => o[0])).not.toContain("secret");
  });

  test("is not generated without neoforge servers", () => {
    expect(renderNeoForgePatches(config())).toEqual({});
  });
});
