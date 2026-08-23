import { describe, expect, test } from "bun:test";
import { CloudConfigSchema, hostPort } from "../src/index.ts";

/** Shorthand: parse and return the issue messages, joined. */
function issues(input: unknown): string {
  const result = CloudConfigSchema.safeParse(input);
  if (result.success) return "";
  return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
}

const minimal = {
  network: { name: "test" },
  groups: { lobby: { version: "1.21.10", fallback: true } },
};

describe("defaults", () => {
  test("a minimal config fills in every derived field", () => {
    const cfg = CloudConfigSchema.parse(minimal);
    expect(cfg.network.entry_port).toBe(25565);
    expect(cfg.network.forwarding).toBe("modern");
    expect(cfg.network.online).toBe(true);
    expect(cfg.network.storage).toBe("bind");
    expect(cfg.proxy.software).toBe("velocity");
    expect(cfg.proxy.memory).toBe("512m");
    expect(cfg.proxy.ports).toEqual([]);
    expect(cfg.proxy.env).toEqual({});
    expect(cfg.groups.lobby.software).toBe("paper");
    expect(cfg.groups.lobby.min).toBe(1);
    expect(cfg.groups.lobby.static).toBe(false);
  });

  test("the proxy version default is a pinned 3.x, never latest", () => {
    // "latest" resolves to a Velocity 4.0.0 snapshot needing Java 25.
    const cfg = CloudConfigSchema.parse(minimal);
    expect(cfg.proxy.version).not.toBe("latest");
    expect(cfg.proxy.version.startsWith("3.")).toBe(true);
  });
});

describe("names", () => {
  test("rejects names that are not DNS-safe", () => {
    for (const name of ["Test", "1test", "te st", "test_net", "", "a".repeat(33)]) {
      expect(issues({ ...minimal, network: { name } })).not.toBe("");
    }
  });

  test("accepts lowercase names with digits and dashes", () => {
    expect(issues({ ...minimal, network: { name: "my-net-2" } })).toBe("");
  });
});

describe("memory and version formats", () => {
  test("memory must look like 512M or 4G", () => {
    expect(issues({ ...minimal, proxy: { memory: "512" } })).toContain("512M or 4G");
    expect(issues({ ...minimal, proxy: { memory: "2G" } })).toBe("");
  });

  test("Minecraft versions must be numeric", () => {
    expect(
      issues({ ...minimal, groups: { lobby: { version: "latest", fallback: true } } }),
    ).toContain("1.21.10");
  });
});

describe("fallback rules", () => {
  test("requires exactly one fallback group", () => {
    expect(
      issues({ ...minimal, groups: { lobby: { version: "1.21.10" } } }),
    ).toContain("exactly one group must set fallback");
  });

  test("rejects two fallback groups and names them", () => {
    const msg = issues({
      ...minimal,
      groups: {
        lobby: { version: "1.21.10", fallback: true },
        hub: { version: "1.21.10", fallback: true },
      },
    });
    expect(msg).toContain("only one group");
    expect(msg).toContain("lobby");
    expect(msg).toContain("hub");
  });

  test("the fallback group must run at least one instance", () => {
    expect(
      issues({
        ...minimal,
        groups: { lobby: { version: "1.21.10", fallback: true, min: 0 } },
      }),
    ).toContain("min >= 1");
  });

  test("requires at least one group", () => {
    expect(issues({ ...minimal, groups: {} })).toContain("at least one group");
  });
});

describe("static groups", () => {
  test("cannot be scaled past one instance", () => {
    expect(
      issues({
        ...minimal,
        groups: {
          lobby: { version: "1.21.10", fallback: true },
          smp: { version: "1.21.10", static: true, min: 2 },
        },
      }),
    ).toContain("cannot have more than one instance");
  });
});

describe("forwarding", () => {
  test('rejects forwarding = "none" with a reason', () => {
    const msg = issues({ ...minimal, network: { name: "test", forwarding: "none" } });
    expect(msg).toContain("offline-mode UUID");
  });

  test("rejects modern forwarding on a non-Velocity proxy", () => {
    // Modern forwarding is a Velocity protocol; BungeeCord fails at login
    // with the same message a bad secret produces.
    const msg = issues({
      ...minimal,
      network: { name: "test", forwarding: "modern" },
      proxy: { software: "bungeecord" },
    });
    expect(msg).toContain("only exists in Velocity");
    expect(msg).toContain("bungeeguard");
  });

  test("accepts bungeeguard and legacy on BungeeCord", () => {
    for (const forwarding of ["bungeeguard", "legacy"]) {
      expect(
        issues({
          ...minimal,
          network: { name: "test", forwarding },
          proxy: { software: "bungeecord" },
        }),
      ).toBe("");
    }
  });

  test("accepts every mode on Velocity", () => {
    for (const forwarding of ["modern", "bungeeguard", "legacy"]) {
      expect(issues({ ...minimal, network: { name: "test", forwarding } })).toBe("");
    }
  });
});

describe("proxy ports", () => {
  test("accepts compose short syntax", () => {
    for (const p of ["19132", "19132:19132", "19132:19132/udp", "8080:80/tcp"]) {
      expect(issues({ ...minimal, proxy: { ports: [p] } })).toBe("");
    }
  });

  test("rejects host IPs and malformed mappings", () => {
    for (const p of ["0.0.0.0:19132:19132", "19132/sctp", "abc", "19132:"]) {
      expect(issues({ ...minimal, proxy: { ports: [p] } })).not.toBe("");
    }
  });

  test("rejects republishing the Minecraft port", () => {
    expect(issues({ ...minimal, proxy: { ports: ["25565:25565"] } })).toContain(
      "entry_port",
    );
  });

  test("allows the entry port number on UDP", () => {
    // Docker binds 25565/tcp and 25565/udp independently.
    expect(issues({ ...minimal, proxy: { ports: ["25565:25565/udp"] } })).toBe("");
  });

  test("rejects two mappings on the same host port and protocol", () => {
    expect(
      issues({ ...minimal, proxy: { ports: ["19132:19132/udp", "19132:19133/udp"] } }),
    ).toContain("both publish");
  });

  test("allows the same port on tcp and udp", () => {
    expect(
      issues({ ...minimal, proxy: { ports: ["19132:19132/udp", "19132:19132/tcp"] } }),
    ).toBe("");
  });
});

describe("hostPort", () => {
  test("splits mapping forms", () => {
    expect(hostPort("19132")).toEqual({ port: 19132, proto: "tcp" });
    expect(hostPort("19132:19133")).toEqual({ port: 19132, proto: "tcp" });
    expect(hostPort("19132:19133/udp")).toEqual({ port: 19132, proto: "udp" });
  });
});

describe("unknown fields", () => {
  test("a hallucinated field is dropped, not silently honoured", () => {
    // Zod strips unknown keys. What matters is that it never reaches a
    // renderer as if it were configuration.
    const cfg = CloudConfigSchema.parse({
      ...minimal,
      network: { name: "test", enable_rockets: true },
    });
    expect("enable_rockets" in cfg.network).toBe(false);
  });
});
