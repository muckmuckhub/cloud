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

/**
 * Java major version per Minecraft version.
 *
 * Getting this wrong produces UnsupportedClassVersionError with a class file
 * number rather than a Java version, which is why the mapping lives in one
 * place with the numbers written down:
 *   class 52=Java 8, 61=17, 65=21, 69=25.
 */
export function javaFor(mcVersion: string): number {
  const [major, minor] = mcVersion.split(".").map(Number);
  // Minecraft moved to year-based versioning (26.1). Those need Java 25.
  if (major >= 26) return 25;
  if (major !== 1) return 25;
  if (minor >= 21) return 21;
  if (minor >= 18) return 17;
  if (minor >= 17) return 16;
  return 8;
}

/**
 * Velocity 4.x requires Java 25; 3.x runs on 17+. "latest" resolves to a
 * 4.x snapshot, so an unpinned proxy silently needs a newer runtime than
 * the image provides.
 */
export function proxyJavaFor(software: string, version: string): number {
  if (software !== "velocity") return 17;
  if (/^4\./.test(version)) return 25;
  if (version === "latest") return 25; // latest is currently a 4.x snapshot
  return 21;
}

/**
 * An image pin: the tag the digest was taken from, then the digest.
 *
 * The tag is part of the value on purpose. With a digest present Docker
 * ignores the tag entirely, so a bare digest would keep running a Java 21
 * image after `version` moved to a Minecraft that needs 25 — the
 * UnsupportedClassVersionError this tool exists to prevent. Naming the tag
 * lets validation notice that the pin no longer matches.
 */
const IMAGE_PIN = z
  .string()
  .regex(
    /^java\d+@sha256:[a-f0-9]{64}$/,
    'must look like "java21@sha256:<64 hex digits>" — the image tag, then its digest',
  )
  .describe("Optional image digest pin, as <java tag>@sha256:<digest>. Leave unset normally.");

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

export const ProxySoftware = z.enum(["velocity", "bungeecord", "waterfall"]);
export const ServerSoftware = z.enum([
  "paper",
  "folia",
  "purpur",
  "spigot",
  "fabric",
  "neoforge",
]);

/**
 * Whether a server runs Bukkit plugins. Fabric and NeoForge run mods instead:
 * a plugin jar dropped into one is not loaded, and Hangar serves only plugins.
 */
export function runsPlugins(software: string): boolean {
  return software !== "fabric" && software !== "neoforge";
}

/**
 * Proxy-Compatible-Forge, pinned. It is what lets a NeoForge server trust the
 * proxy, for all three forwarding modes. Unlike FabricProxy-Lite one release
 * covers every Minecraft version. Refresh from
 * https://modrinth.com/mod/proxy-compatible-forge/versions
 */
export const PROXY_COMPATIBLE_FORGE = "1.3.1";

/**
 * The FabricProxy-Lite release for a Minecraft version, or null if none is
 * known. FabricProxy-Lite is what lets a Fabric server accept Velocity's
 * modern forwarding, and it is released per range of Minecraft versions — so
 * one pin cannot cover them all, and a table keeps every one of them pinned.
 * Refresh from https://modrinth.com/mod/fabricproxy-lite/versions
 */
export const FABRIC_PROXY_LITE: { from: string; to: string; version: string }[] = [
  { from: "1.21", to: "1.21.8", version: "v2.10.1" },
  { from: "1.21.9", to: "1.21.11", version: "v2.11.0" },
  // A bound without a patch number covers every patch of it: 26.3 is 26.3.x.
  { from: "26.1", to: "26.3", version: "v2.12.0" },
];

/** "1.21.10" -> 1021010, for range comparison. A missing patch is 0. */
function versionKey(v: string): number {
  const [major = 0, minor = 0, patch = 0] = v.split(".").map(Number);
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function fabricProxyLiteFor(mcVersion: string): string | null {
  const v = versionKey(mcVersion);
  const hit = FABRIC_PROXY_LITE.find(({ from, to }) => {
    const upper = versionKey(to) + (to.split(".").length === 2 ? 999 : 0);
    return v >= versionKey(from) && v <= upper;
  });
  return hit?.version ?? null;
}

/** A modrinth reference's slug, e.g. "fabricproxy-lite" from "fabricproxy-lite:v2.11.0". */
export function refSlug(ref: string): string {
  return ref.split(":")[0].toLowerCase();
}
/**
 * There is no "none". It used to be listed here and rejected by a refinement,
 * which meant the AI tool schema offered the model a choice that could never
 * validate. It is still named in the error, because "none" is what people
 * type when they want an offline-mode network.
 */
export const Forwarding = z.enum(["modern", "legacy", "bungeeguard"], {
  errorMap: (issue, ctx) =>
    issue.code === "invalid_enum_value" && ctx.data === "none"
      ? {
          message:
            "forwarding = \"none\" gives every player an offline-mode UUID and lets anyone " +
            "reach backends unauthenticated. Use \"modern\".",
        }
      : { message: `must be "modern", "legacy" or "bungeeguard"` },
});

const JAVA = z
  .number()
  .int()
  .min(8)
  .max(99)
  .describe("Java major version for the container image, e.g. 21 or 25");

export const ProxySchema = z.object({
  software: ProxySoftware.default("velocity"),
  // NOT "latest": for Velocity that resolves to a 4.x snapshot which needs
  // Java 25 and is a dev build. Pin a stable release by default.
  version: z.string().default("3.5.1"),
  java: JAVA.optional().describe(
    "Override the Java version. Leave unset to derive it from the software version.",
  ),
  memory: MEMORY.default("512m"),
  memory_limit: MEMORY_LIMIT.optional(),
  pin: IMAGE_PIN.optional(),
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
  pin: IMAGE_PIN.optional(),
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

    // A pin taken from a different Java tag than the one this config derives
    // would run the wrong runtime, silently: the digest wins over the tag.
    const pins: [(string | number)[], string | undefined, number][] = [
      [
        ["proxy", "pin"],
        cfg.proxy.pin,
        cfg.proxy.java ?? proxyJavaFor(cfg.proxy.software, cfg.proxy.version),
      ],
      ...Object.entries(cfg.groups).map(
        ([name, g]) =>
          [["groups", name, "pin"], g.pin, g.java ?? javaFor(g.version)] as [
            string[],
            string | undefined,
            number,
          ],
      ),
    ];
    for (const [path, pin, java] of pins) {
      const tag = pin?.split("@")[0];
      if (tag && tag !== `java${java}`) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message:
            `pin is for ${tag}, but this config needs java${java}. Docker would run the ` +
            `pinned ${tag} image regardless. Pin the java${java} image, or remove the pin.`,
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
    for (const [name, g] of Object.entries(cfg.groups)) {
      if (runsPlugins(g.software)) continue;
      if (g.hangar.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", name, "hangar"],
          message:
            `Hangar serves Paper plugins, which a ${g.software} server cannot load. ` +
            "Use modrinth for mods.",
        });
      }
      if (g.software === "neoforge") {
        // Proxy-Compatible-Forge supports NeoForge from 1.20.1 on; before
        // that there is no NeoForge at all.
        const [major, minor, patch = 0] = g.version.split(".").map(Number);
        if (major === 1 && (minor < 20 || (minor === 20 && patch < 1))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["groups", name, "version"],
            message: "NeoForge starts at Minecraft 1.20.1.",
          });
        }
        continue;
      }
      // FabricProxy-Lite implements Velocity's modern forwarding and nothing
      // else. Under legacy forwarding a Fabric server has no way to read the
      // forwarded identity: every player would join with an offline UUID.
      if (cfg.network.forwarding !== "modern") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", name, "software"],
          message:
            `a fabric server needs forwarding = "modern" on a Velocity proxy — ` +
            `FabricProxy-Lite, which lets it trust the proxy, supports nothing else.`,
        });
      }
      const ownsProxyMod = g.modrinth.some((r) => refSlug(r) === "fabricproxy-lite");
      if (!ownsProxyMod && !fabricProxyLiteFor(g.version)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", name, "version"],
          message:
            `no known FabricProxy-Lite release for Minecraft ${g.version}, and a ` +
            `fabric server behind a proxy needs one. Pick one from ` +
            `https://modrinth.com/mod/fabricproxy-lite/versions and add it: ` +
            `modrinth = ["fabricproxy-lite:<version>"]`,
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
          `"${cfg.proxy.software}". Use forwarding = "bungeeguard" (recommended; ` +
          `cloud apply installs and configures BungeeGuard) or "legacy" (only safe ` +
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
  });

export type CloudConfig = z.infer<typeof CloudConfigSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type Proxy = z.infer<typeof ProxySchema>;

/** Config version. Bumped only on breaking format changes; see SPEC.md. */
export const CONFIG_VERSION = 1;
