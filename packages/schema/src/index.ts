import { z } from "zod";

/**
 * The config schema.
 *
 * This object is used in three places and must stay the only definition:
 *   1. validating cloud.toml that a human hand-edited
 *   2. generating the JSON Schema the AI model fills via tool call
 *   3. parsing what the model returned
 *
 * A hallucinated field is therefore a parse error, not a runtime surprise.
 */

const NAME = z
  .string()
  .min(1)
  .max(32)
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "must be lowercase letters, digits and dashes, starting with a letter",
  )
  .describe("DNS-safe identifier; becomes the container name");

const MEMORY = z
  .string()
  .regex(/^\d+[MmGg]$/, "must look like 512M or 4G")
  .describe("JVM heap size, e.g. 2G");

const MEMORY_LIMIT = z
  .string()
  .regex(/^\d+[MmGg]$/, "must look like 1536M or 5G")
  .describe(
    "Container memory cap. Leave unset to derive it from memory; set it higher " +
      "if a plugin needs a lot of off-heap memory.",
  );

/** `512m`, `512M`, `4G` -> MiB. Assumes the MEMORY format has been validated. */
export function memoryMiB(value: string): number {
  const n = Number(value.slice(0, -1));
  return /[Gg]$/.test(value) ? n * 1024 : n;
}

/**
 * The container memory cap for a JVM with the given heap.
 *
 * `memory` is the heap (-Xmx), and a JVM uses a good deal more than its heap:
 * metaspace, thread stacks, the JIT, and Netty's direct buffers. A cap equal
 * to the heap gets the container OOM-killed under load, which looks like a
 * random crash loop with nothing in the server log. A quarter on top, and at
 * least 512M, covers that. Lives here rather than in the renderer because
 * validation needs it too.
 */
export function containerLimitMiB(heap: string, limit?: string): number {
  if (limit) return memoryMiB(limit);
  const mib = memoryMiB(heap);
  return mib + Math.max(Math.ceil(mib / 4), 512);
}

const MC_VERSION = z
  .string()
  .regex(/^\d+\.\d+(\.\d+)?$/, "must look like 1.21.10")
  .describe("Minecraft version, e.g. 1.21.10");

/**
 * A published port on the proxy, in Compose's short syntax:
 * `19132`, `19132:19132`, `19132:19132/udp`. Host IPs are deliberately not
 * accepted — binding to a specific interface is a deployment concern that
 * belongs in the Docker context, not in a file that must render identically
 * everywhere.
 */
const PORT_MAPPING = z
  .string()
  .regex(
    /^\d{1,5}(:\d{1,5})?(\/(tcp|udp))?$/,
    'must look like "19132", "19132:19132" or "19132:19132/udp"',
  )
  .describe("Extra published port on the proxy, e.g. 19132:19132/udp for Geyser");

/**
 * Host side of a port mapping, plus its protocol. Both halves matter: Docker
 * happily binds 19132/tcp and 19132/udp at the same time, so a collision check
 * on the number alone would reject a legal config.
 */
export function hostPort(mapping: string): { port: number; proto: "tcp" | "udp" } {
  const [hostSide, proto] = mapping.split("/");
  return {
    port: Number(hostSide.split(":")[0]),
    proto: proto === "udp" ? "udp" : "tcp",
  };
}

/**
 * A pinned plugin reference, `slug:version`. The version is required: an
 * unpinned reference resolves to whatever is newest at container start, which
 * is the same silent drift that turned `/latest/` download URLs into
 * crash-looping servers. A URL here is a mistake — those go in `plugins`.
 */
const pluginRef = (site: string, example: string, where: string) =>
  z
    .string()
    .regex(
      /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.+-]+$/,
      `must look like "${example}" — a project slug and a pinned version. ` +
        `Versions are listed at ${where}`,
    )
    .describe(`${site} project slug and pinned version, e.g. ${example}`);

const MODRINTH_REFS = z
  .array(pluginRef("Modrinth", "luckperms:v5.5.71-bukkit", "https://modrinth.com/plugin/<slug>/versions"))
  .default([])
  .describe("Plugins from Modrinth, as slug:version");

const HANGAR_REFS = z
  .array(pluginRef("Hangar", "ViaVersion:5.11.0", "https://hangar.papermc.io/<author>/<slug>/versions"))
  .default([])
  .describe("Plugins from Hangar (hangar.papermc.io), as slug:version");

export const ProxySoftware =z.enum(["velocity", "bungeecord", "waterfall"]);
export const ServerSoftware = z.enum(["paper", "folia", "purpur", "spigot"]);
export const Forwarding = z.enum(["modern", "legacy", "bungeeguard", "none"]);

const JAVA = z
  .number()
  .int()
  .min(8)
  .max(99)
  .describe("Java major version for the container image, e.g. 21 or 25");

export const ProxySchema = z.object({
  software: ProxySoftware.default("velocity"),
  // NOT "latest": for Velocity that resolves to a 4.0.0 snapshot which needs
  // Java 25 and is a dev build. Pin a stable release by default.
  version: z.string().default("3.4.0-SNAPSHOT"),
  java: JAVA.optional().describe(
    "Override the Java version. Leave unset to derive it from the software version.",
  ),
  memory: MEMORY.default("512m"),
  memory_limit: MEMORY_LIMIT.optional(),
  plugins: z
    .array(z.string().url())
    .default([])
    .describe("Direct download URLs for proxy plugins"),
  modrinth: MODRINTH_REFS,
  hangar: HANGAR_REFS,
  ports: z
    .array(PORT_MAPPING)
    .default([])
    .describe(
      "Extra ports published on the proxy container. The Minecraft port is " +
        "network.entry_port and must not be repeated here. Used by things that " +
        "listen alongside the proxy, such as Geyser on UDP 19132.",
    ),
  env: z
    .record(z.string(), z.string())
    .default({})
    .describe("Extra environment variables passed to the proxy container"),
});

export const GroupSchema = z.object({
  software: ServerSoftware.default("paper"),
  version: MC_VERSION,
  java: JAVA.optional().describe(
    "Override the Java version. Leave unset to derive it from the Minecraft version.",
  ),
  memory: MEMORY.default("2G"),
  memory_limit: MEMORY_LIMIT.optional(),
  min: z
    .number()
    .int()
    .min(0)
    .max(50)
    .default(1)
    .describe("How many instances to keep running"),
  fallback: z
    .boolean()
    .default(false)
    .describe("Players land here on join and on backend failure. Exactly one group must set this."),
  static: z
    .boolean()
    .default(false)
    .describe(
      "Gives the server its own directory under data/ instead of a Docker " +
        "volume, and limits it to one instance. Both kinds keep their world " +
        "across restarts; this one is the kind you browse and back up. " +
        "Use for SMP/survival.",
    ),
  template: z
    .string()
    .optional()
    .describe(
      "Name of a directory under templates/ whose contents are copied over " +
        "every instance of this group on every start. The template owns those " +
        "files: edit them there, not in data/. Files it does not contain, " +
        "including the world, are untouched.",
    ),
  plugins: z.array(z.string().url()).default([]),
  modrinth: MODRINTH_REFS,
  hangar: HANGAR_REFS,
  env: z
    .record(z.string(), z.string())
    .default({})
    .describe("Extra environment variables passed to the container"),
});

export const NetworkSchema = z.object({
  name: NAME,
  entry_port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(25565)
    .describe("The single host port players connect to"),
  motd: z.string().default("A Velocity Server"),
  forwarding: Forwarding.default("modern"),
  online: z
    .boolean()
    .default(true)
    .describe("Whether the proxy authenticates players against Mojang"),
  domain: z
    .string()
    .optional()
    .describe("Public hostname, used only to print DNS instructions"),
  storage: z
    .enum(["bind", "volume"])
    .default("bind")
    .describe(
      "Where persistent server data lives. \"bind\" puts it in ./data/<server> " +
        "where you can browse it directly. \"volume\" uses a Docker named volume, " +
        "which is much faster on Windows and macOS because it stays inside the " +
        "Docker VM instead of crossing the host filesystem bridge.",
    ),
});

export const CloudConfigSchema = z
  .object({
    network: NetworkSchema,
    proxy: ProxySchema.default({}),
    groups: z.record(NAME, GroupSchema).refine((g) => Object.keys(g).length > 0, {
      message: "at least one group is required",
    }),
  })
  .superRefine((cfg, ctx) => {
    const fallbacks = Object.entries(cfg.groups).filter(([, g]) => g.fallback);
    if (fallbacks.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groups"],
        message:
          "exactly one group must set fallback = true (players need somewhere to land)",
      });
    }
    if (fallbacks.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groups"],
        message: `only one group may set fallback = true, found: ${fallbacks
          .map(([n]) => n)
          .join(", ")}`,
      });
    }
    // A cap at or below the heap is an OOM kill waiting for the heap to fill,
    // and the server log says nothing about it — Docker just restarts it.
    const limits: [(string | number)[], string, string | undefined][] = [
      [["proxy", "memory_limit"], cfg.proxy.memory, cfg.proxy.memory_limit],
      ...Object.entries(cfg.groups).map(
        ([name, g]) =>
          [["groups", name, "memory_limit"], g.memory, g.memory_limit] as [
            string[],
            string,
            string | undefined,
          ],
      ),
    ];
    for (const [path, heap, limit] of limits) {
      if (limit && memoryMiB(limit) <= memoryMiB(heap)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message:
            `memory_limit ${limit} must be larger than memory ${heap}: the JVM ` +
            `needs room beyond its heap. Remove it to use the derived default.`,
        });
      }
    }

    for (const [name, g] of Object.entries(cfg.groups)) {
      if (g.static && g.min > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", name, "min"],
          message:
            "a static group keeps its own world, so it cannot have more than one instance",
        });
      }
      if (g.fallback && g.min < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", name, "min"],
          message: "the fallback group must have min >= 1",
        });
      }
    }
    // Modern forwarding is a Velocity protocol. BungeeCord and Waterfall have
    // no implementation of it, and a proxy configured this way starts fine and
    // then rejects every login with "Unable to verify player identity" — the
    // same symptom as a bad secret, from a completely different cause.
    if (cfg.network.forwarding === "modern" && cfg.proxy.software !== "velocity") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network", "forwarding"],
        message:
          `forwarding = "modern" only exists in Velocity, but proxy.software is ` +
          `"${cfg.proxy.software}". Use forwarding = "bungeeguard" (recommended, ` +
          `needs the BungeeGuard plugin on every backend) or "legacy" (only safe ` +
          `if backends are unreachable from outside the Docker network).`,
      });
    }

    const seenPorts = new Map<string, string>();
    for (const mapping of cfg.proxy.ports) {
      const { port, proto } = hostPort(mapping);
      // entry_port is the Minecraft listener, which is TCP.
      if (port === cfg.network.entry_port && proto === "tcp") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["proxy", "ports"],
          message:
            `"${mapping}" publishes host port ${port}, which is already ` +
            `network.entry_port. Docker refuses to bind it twice.`,
        });
      }
      const key = `${port}/${proto}`;
      const first = seenPorts.get(key);
      if (first) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["proxy", "ports"],
          message: `"${mapping}" and "${first}" both publish ${port}/${proto}`,
        });
      } else {
        seenPorts.set(key, mapping);
      }
    }

    if (cfg.network.forwarding === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network", "forwarding"],
        message:
          "forwarding = \"none\" gives every player an offline-mode UUID and lets anyone " +
          "reach backends unauthenticated. Use \"modern\".",
      });
    }
  });

export type CloudConfig = z.infer<typeof CloudConfigSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type Proxy = z.infer<typeof ProxySchema>;

/** Config version. Bumped only on breaking format changes; see SPEC.md. */
export const CONFIG_VERSION = 1;
