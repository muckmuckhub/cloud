import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import {
  hostDirs,
  hostPluginDir,
  instanceNames,
  javaFor,
  proxyJavaFor,
  renderCompose,
} from "../src/render/compose.ts";
import { config } from "./helpers.ts";

interface Service {
  image: string;
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  expose?: string[];
}

function services(cfg: Parameters<typeof renderCompose>[0]): Record<string, Service> {
  return (parseYaml(renderCompose(cfg)) as { services: Record<string, Service> })
    .services;
}

describe("javaFor", () => {
  // Class file numbers, because that is what the error message reports:
  // 52=Java 8, 60=16, 61=17, 65=21, 69=25.
  test.each([
    ["1.8.8", 8],
    ["1.12.2", 8],
    ["1.16.5", 8],
    ["1.17", 16],
    ["1.17.1", 16],
    ["1.18.2", 17],
    ["1.20.4", 17],
    ["1.21", 21],
    ["1.21.10", 21],
    ["26.1", 25],
  ])("%s needs Java %i", (version, java) => {
    expect(javaFor(version as string)).toBe(java as number);
  });
});

describe("proxyJavaFor", () => {
  test("Velocity 3.x runs on 21", () => {
    expect(proxyJavaFor("velocity", "3.4.0-SNAPSHOT")).toBe(21);
  });

  test("Velocity 4.x needs 25", () => {
    expect(proxyJavaFor("velocity", "4.0.0-SNAPSHOT")).toBe(25);
  });

  test('"latest" is treated as 4.x, because that is what it resolves to', () => {
    expect(proxyJavaFor("velocity", "latest")).toBe(25);
  });

  test("BungeeCord and Waterfall run on 17", () => {
    expect(proxyJavaFor("bungeecord", "latest")).toBe(17);
    expect(proxyJavaFor("waterfall", "latest")).toBe(17);
  });
});

describe("instanceNames", () => {
  test("a single instance keeps the group name", () => {
    expect(instanceNames("lobby", 1)).toEqual(["lobby"]);
    expect(instanceNames("lobby", 0)).toEqual(["lobby"]);
  });

  test("several instances are numbered from one", () => {
    expect(instanceNames("lobby", 3)).toEqual(["lobby-1", "lobby-2", "lobby-3"]);
  });
});

describe("ports", () => {
  test("only the proxy publishes anything", () => {
    const svc = services(
      config({
        groups: {
          lobby: { version: "1.21.10", fallback: true },
          smp: { version: "1.21.10", static: true },
        },
      }),
    );
    for (const [name, s] of Object.entries(svc)) {
      if (name === "proxy") expect(s.ports?.length).toBeGreaterThan(0);
      else expect(s.ports).toBeUndefined();
    }
  });

  test("backends expose 25565 internally rather than publishing it", () => {
    const svc = services(config());
    expect(svc.lobby.expose).toEqual(["25565"]);
    expect(svc.lobby.ports).toBeUndefined();
  });

  test("the entry port is overridable at runtime but defaults from config", () => {
    const svc = services(config({ network: { name: "test", entry_port: 25577 } }));
    expect(svc.proxy.ports).toEqual(["${ENTRY_PORT:-25577}:25565"]);
  });

  test("extra proxy ports are published verbatim", () => {
    const svc = services(config({ proxy: { ports: ["19132:19132/udp"] } }));
    expect(svc.proxy.ports).toEqual([
      "${ENTRY_PORT:-25565}:25565",
      "19132:19132/udp",
    ]);
  });
});

describe("proxy environment", () => {
  test("velocity gets its version pinned", () => {
    expect(services(config()).proxy.environment?.VELOCITY_VERSION).toBe(
      "3.4.0-SNAPSHOT",
    );
  });

  test("bungeecord gets no velocity version", () => {
    const cfg = config({
      network: { name: "test", forwarding: "legacy" },
      proxy: { software: "bungeecord" },
    });
    const env = services(cfg).proxy.environment ?? {};
    expect(env.TYPE).toBe("BUNGEECORD");
    expect(env.VELOCITY_VERSION).toBeUndefined();
  });

  test("user proxy env wins over derived values", () => {
    const cfg = config({ proxy: { env: { CFG_MOTD: "mine", EXTRA: "1" } } });
    const env = services(cfg).proxy.environment ?? {};
    expect(env.CFG_MOTD).toBe("mine");
    expect(env.EXTRA).toBe("1");
  });
});

describe("backend environment", () => {
  test("backends never authenticate — the proxy does", () => {
    expect(services(config()).lobby.environment?.ONLINE_MODE).toBe("FALSE");
  });

  test("paper's velocity online-mode mirrors the network, not ONLINE_MODE", () => {
    // These two mean opposite things. Setting them the same breaks either
    // skins or login.
    const env = services(config()).lobby.environment ?? {};
    expect(env.ONLINE_MODE).toBe("FALSE");
    expect(env.CFG_VELOCITY_ONLINE_MODE).toBe("true");
  });

  test("online = false propagates to paper", () => {
    const cfg = config({ network: { name: "test", online: false } });
    expect(services(cfg).lobby.environment?.CFG_VELOCITY_ONLINE_MODE).toBe("false");
  });

  test("exactly one forwarding style is enabled", () => {
    const modern = services(config()).lobby.environment ?? {};
    expect(modern.CFG_VELOCITY_ENABLED).toBe("true");
    expect(modern.CFG_BUNGEE_ENABLED).toBe("false");

    const legacy =
      services(
        config({
          network: { name: "test", forwarding: "legacy" },
          proxy: { software: "bungeecord" },
        }),
      ).lobby.environment ?? {};
    expect(legacy.CFG_VELOCITY_ENABLED).toBe("false");
    expect(legacy.CFG_BUNGEE_ENABLED).toBe("true");
  });

  test("the secret is referenced only when the mode has one", () => {
    expect(services(config()).lobby.environment?.CFG_FORWARDING_SECRET).toContain(
      "FORWARDING_SECRET",
    );
    const legacy = services(
      config({
        network: { name: "test", forwarding: "legacy" },
        proxy: { software: "bungeecord" },
      }),
    );
    expect(legacy.lobby.environment?.CFG_FORWARDING_SECRET).toBeUndefined();
  });

  test("the secret error message names a command that exists", () => {
    const secret = services(config()).lobby.environment?.CFG_FORWARDING_SECRET ?? "";
    expect(secret).toContain("cloud apply");
  });

  test("the cloud env API describes the whole network", () => {
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true, min: 2 },
        smp: { version: "1.21.10", static: true },
      },
    });
    const env = services(cfg)["lobby-2"].environment ?? {};
    expect(env.CLOUD_NETWORK).toBe("test");
    expect(env.CLOUD_GROUP).toBe("lobby");
    expect(env.CLOUD_INSTANCE).toBe("lobby-2");
    expect(env.CLOUD_INSTANCE_INDEX).toBe("2");
    expect(env.CLOUD_GROUP_SIZE).toBe("2");
    expect(env.CLOUD_FALLBACK).toBe("lobby-1");
    expect(env.CLOUD_GROUPS).toBe("lobby,smp");
    expect(env.CLOUD_SERVERS).toBe("lobby-1,lobby-2,smp");
    expect(env.CLOUD_PROXY).toBe("test-proxy");
    expect(env.CLOUD_STATIC).toBe("false");
  });

  test("group env overrides derived values", () => {
    const cfg = config({
      groups: {
        lobby: {
          version: "1.21.10",
          fallback: true,
          env: { CLOUD_GROUP: "custom", MOTD: "hi" },
        },
      },
    });
    const env = services(cfg).lobby.environment ?? {};
    expect(env.CLOUD_GROUP).toBe("custom");
    expect(env.MOTD).toBe("hi");
  });
});

describe("images", () => {
  test("java version follows the Minecraft version", () => {
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true },
        old: { version: "1.16.5" },
      },
    });
    const svc = services(cfg);
    expect(svc.lobby.image).toBe("itzg/minecraft-server:java21");
    expect(svc.old.image).toBe("itzg/minecraft-server:java8");
  });

  test("an explicit java override wins", () => {
    const cfg = config({
      groups: { lobby: { version: "1.21.10", fallback: true, java: 25 } },
      proxy: { java: 17 },
    });
    const svc = services(cfg);
    expect(svc.lobby.image).toBe("itzg/minecraft-server:java25");
    expect(svc.proxy.image).toBe("itzg/mc-proxy:java17");
  });

  test("the proxy uses the proxy image, not the server image", () => {
    expect(services(config()).proxy.image).toStartWith("itzg/mc-proxy:");
  });
});

describe("storage", () => {
  test('static groups bind-mount under ./data with storage = "bind"', () => {
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true },
        smp: { version: "1.21.10", static: true },
      },
    });
    expect(services(cfg).smp.volumes).toContain("./data/smp:/data");
  });

  test('storage = "volume" moves them into a named volume', () => {
    const cfg = config({
      network: { name: "test", storage: "volume" },
      groups: {
        lobby: { version: "1.21.10", fallback: true },
        smp: { version: "1.21.10", static: true },
      },
    });
    const yml = renderCompose(cfg);
    expect(services(cfg).smp.volumes).toContain("smp-data:/data");
    expect(yml).toContain("  smp-data:");
  });

  test("replaceable groups always use a named volume", () => {
    expect(services(config()).lobby.volumes).toContain("lobby-data:/data");
  });

  test("a bind-mounted static group declares no named volume", () => {
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true },
        smp: { version: "1.21.10", static: true },
      },
    });
    expect(renderCompose(cfg)).not.toContain("smp-data:");
  });
});

describe("templates", () => {
  const templated = config({
    groups: { lobby: { version: "1.21.10", fallback: true, template: "hub" } },
  });

  test("a template is mounted read-only at the image's own seeding hook", () => {
    // /config is the only path the image copies from. Mounting at /template
    // was a silent no-op: nothing ever read it.
    expect(services(templated).lobby.volumes).toContain("./templates/hub:/config:ro");
    expect(services(templated).lobby.volumes).not.toContain(
      "./templates/hub:/template:ro",
    );
  });

  test("the whole template tree lands in /data, not just /data/config", () => {
    expect(services(templated).lobby.environment?.COPY_CONFIG_DEST).toBe("/data");
  });

  test("the template wins on every start, not just the first", () => {
    // The image's default skips files that are newer in the destination,
    // which made a template a one-shot seed: edit it later and nothing
    // happened, silently. One edit in templates/ must reach every instance.
    expect(services(templated).lobby.environment?.SYNC_SKIP_NEWER_IN_DESTINATION).toBe(
      "false",
    );
  });

  test("every instance of a group seeds from the same template", () => {
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true, min: 3, template: "hub" },
      },
    });
    const svc = services(cfg);
    for (const n of ["lobby-1", "lobby-2", "lobby-3"]) {
      expect(svc[n].volumes).toContain("./templates/hub:/config:ro");
      expect(svc[n].environment?.COPY_CONFIG_DEST).toBe("/data");
    }
  });

  test("groups without a template get none of that machinery", () => {
    const env = services(config()).lobby.environment ?? {};
    expect(env.COPY_CONFIG_DEST).toBeUndefined();
    expect(env.SYNC_SKIP_NEWER_IN_DESTINATION).toBeUndefined();
  });

  test("a template can still be overridden by hand", () => {
    const cfg = config({
      groups: {
        lobby: {
          version: "1.21.10",
          fallback: true,
          template: "hub",
          env: { SYNC_SKIP_NEWER_IN_DESTINATION: "false" },
        },
      },
    });
    expect(services(cfg).lobby.environment?.SYNC_SKIP_NEWER_IN_DESTINATION).toBe(
      "false",
    );
  });
});

describe("plugin files on the host", () => {
  /** Every bind mount whose source is under ./data. */
  function dataBinds(cfg: Parameters<typeof renderCompose>[0]): string[] {
    return Object.values(services(cfg))
      .flatMap((s) => s.volumes ?? [])
      .filter((v) => v.startsWith("./data/"));
  }

  /** Every bind mount of a host directory apply is responsible for creating. */
  function hostBinds(cfg: Parameters<typeof renderCompose>[0]): string[] {
    return Object.values(services(cfg))
      .flatMap((s) => s.volumes ?? [])
      .filter((v) => v.startsWith("./data/") || v.startsWith("./templates/"));
  }

  test("every server's plugins are reachable at ./data/<server>/plugins", () => {
    // One rule, whatever the storage mode: that is the whole point.
    const cfg = config({
      network: { name: "test", storage: "volume" },
      groups: {
        lobby: { version: "1.21.10", fallback: true, min: 2 },
        smp: { version: "1.21.10", static: true },
      },
    });
    const svc = services(cfg);
    for (const name of ["lobby-1", "lobby-2", "smp"]) {
      expect(svc[name].volumes).toContain(`./data/${name}/plugins:/data/plugins`);
    }
    expect(svc.proxy.volumes).toContain("./data/proxy/plugins:/server/plugins");
  });

  test("a bind-mounted group is not mounted twice", () => {
    // ./data/smp:/data already contains plugins/.
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true },
        smp: { version: "1.21.10", static: true },
      },
    });
    expect(services(cfg).smp.volumes).toContain("./data/smp:/data");
    expect(services(cfg).smp.volumes).not.toContain(
      "./data/smp/plugins:/data/plugins",
    );
  });

  test("a declared template directory is created, not left to Docker", () => {
    // Docker creates a missing bind source as an empty root-owned directory,
    // and the server then seeds from nothing without a word.
    const cfg = config({
      groups: { lobby: { version: "1.21.10", fallback: true, template: "hub" } },
    });
    expect(hostDirs(cfg)).toContain("templates/hub");
  });

  test("no template means no templates directory to create", () => {
    expect(hostDirs(config()).some((d) => d.startsWith("templates/"))).toBe(false);
  });

  test("hostDirs lists exactly the host directories that get bind-mounted", () => {
    // If these drift, apply creates the wrong directories and Docker creates
    // the right ones as root.
    for (const storage of ["bind", "volume"] as const) {
      const cfg = config({
        network: { name: "test", storage },
        groups: {
          // With a template, so the templates/ bind is covered too.
          lobby: { version: "1.21.10", fallback: true, min: 2, template: "hub" },
          smp: { version: "1.21.10", static: true },
        },
      });
      const mounted = [
        ...new Set(hostBinds(cfg).map((v) => v.split(":")[0].replace("./", ""))),
      ];
      expect([...new Set(hostDirs(cfg))].sort()).toEqual(mounted.sort());
    }
  });

  test("hostPluginDir is the same path for every server", () => {
    expect(hostPluginDir("lobby-1")).toBe("data/lobby-1/plugins");
    expect(hostPluginDir("proxy")).toBe("data/proxy/plugins");
  });

  test("plugin mounts are writable — read-only would defeat the purpose", () => {
    for (const v of dataBinds(config())) {
      expect(v.endsWith(":ro")).toBe(false);
    }
  });
});

describe("purity", () => {
  test("rendering twice produces identical bytes", () => {
    const cfg = config({ proxy: { ports: ["19132:19132/udp"] } });
    expect(renderCompose(cfg)).toBe(renderCompose(cfg));
  });

  test("no renderer output depends on the current time or platform", () => {
    // A date or a platform string leaking in would make output differ between
    // machines, which is the constraint CI audits.
    const out = renderCompose(config());
    expect(out).not.toContain(String(new Date().getFullYear()));
    expect(out).not.toContain(process.platform);
  });

  test("output is valid YAML with the expected top-level keys", () => {
    const doc = parseYaml(renderCompose(config())) as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(["networks", "services", "volumes"]);
  });

  test("values that would break YAML are quoted", () => {
    const cfg = config({
      network: { name: "test", motd: "yes: no #1 {a} [b]" },
    });
    expect(services(cfg).proxy.environment?.CFG_MOTD).toBe("yes: no #1 {a} [b]");
  });
});
