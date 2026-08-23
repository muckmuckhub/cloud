/**
 * The design constraints from CONTRIBUTING.md, as assertions.
 *
 * A refactor that quietly publishes a backend port, or drops the
 * modern-forwarding wiring, fails CI here rather than in someone's production
 * network six weeks later.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { CloudConfigSchema, hostPort } from "@cloud/schema";
import { generatedFiles, rollingPlan } from "../packages/cli/src/plan.ts";
import {
  hostDirs,
  hostPluginDir,
  instanceNames,
  renderCompose,
} from "../packages/cli/src/render/compose.ts";
import {
  renderBungeeConfig,
  renderVelocityToml,
  renderPaperPatches,
} from "../packages/cli/src/render/proxy.ts";
import { proxyConfigFile, wiringFor } from "../packages/cli/src/render/forwarding.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

const examplesDir = "examples";
for (const example of await readdir(examplesDir)) {
  const dir = join(examplesDir, example);
  const tomlPath = join(dir, "cloud.toml");
  let raw: unknown;
  try {
    raw = parseToml(await readFile(tomlPath, "utf8"));
  } catch {
    continue;
  }

  console.log(`\n${example}`);
  const parsed = CloudConfigSchema.safeParse(raw);
  check(
    "cloud.toml validates",
    parsed.success,
    parsed.success
      ? ""
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  );
  if (!parsed.success) continue;
  const cfg = parsed.data;
  const wiring = wiringFor(cfg.network.forwarding);

  const compose = parseYaml(renderCompose(cfg)) as {
    services: Record<
      string,
      { ports?: string[]; environment?: Record<string, string>; volumes?: string[] }
    >;
  };

  const published = Object.entries(compose.services)
    .filter(([, s]) => s.ports?.length)
    .map(([n]) => n);
  check(
    "only the proxy publishes a port",
    published.length === 1 && published[0] === "proxy",
    `published: ${published.join(", ") || "(none)"}`,
  );

  // Extra proxy ports are opt-in and must land on the proxy verbatim. A typo
  // that dropped them would be invisible until a Bedrock player could not join.
  const proxyPorts = compose.services.proxy?.ports ?? [];
  check(
    "declared proxy.ports are published",
    cfg.proxy.ports.every((p) => proxyPorts.includes(p)),
    `want ${cfg.proxy.ports.join(", ") || "(none)"}; got ${proxyPorts.join(", ")}`,
  );
  check(
    "no published port collides with entry_port",
    cfg.proxy.ports.every(
      (p) => !(hostPort(p).port === cfg.network.entry_port && hostPort(p).proto === "tcp"),
    ),
  );

  const backends = Object.entries(compose.services).filter(([n]) => n !== "proxy");
  check(
    "every backend has ONLINE_MODE=FALSE",
    backends.every(([, s]) => s.environment?.ONLINE_MODE === "FALSE"),
  );

  // Plugin files must be reachable from the host for every server, whatever
  // the storage mode. A named volume with no bind is unopenable without
  // Docker commands, which is the thing this is here to prevent.
  const everyService = Object.keys(compose.services);
  check(
    "every server exposes its plugins on the host",
    everyService.every((name) => {
      const mounts = compose.services[name]?.volumes ?? [];
      return mounts.some(
        (v) =>
          v.startsWith(`./${hostPluginDir(name)}:`) ||
          v.startsWith(`./data/${name}:/data`),
      );
    }),
    everyService
      .map((n) => `${n}: ${(compose.services[n]?.volumes ?? []).join(" ")}`)
      .join("; "),
  );
  check(
    "host plugin mounts are writable",
    Object.values(compose.services)
      .flatMap((s) => s.volumes ?? [])
      .filter((v) => v.startsWith("./data/"))
      .every((v) => !v.endsWith(":ro")),
  );
  // apply creates these before compose does, so they belong to the user
  // rather than to root. Drift here means Docker wins the race — an empty
  // root-owned directory, and a template that seeds nothing without a word.
  // Deduplicated: every instance of a group mounts the same template.
  const boundDirs = [
    ...new Set(
      Object.values(compose.services)
        .flatMap((s) => s.volumes ?? [])
        .filter((v) => v.startsWith("./data/") || v.startsWith("./templates/"))
        .map((v) => v.split(":")[0].replace("./", "")),
    ),
  ];
  const wanted = [...new Set(hostDirs(cfg))];
  check(
    "hostDirs matches what compose bind-mounts",
    JSON.stringify(wanted.sort()) === JSON.stringify(boundDirs.sort()),
    `hostDirs: ${wanted.join(", ")} | compose: ${boundDirs.join(", ")}`,
  );

  // A template must be mounted where the image actually looks. /template was
  // a silent no-op for as long as it existed: the image has never read that
  // path, so seeding did nothing and said nothing.
  check(
    "nothing is mounted at /template",
    !Object.values(compose.services)
      .flatMap((s) => s.volumes ?? [])
      .some((v) => v.includes(":/template")),
  );
  for (const [name, g] of Object.entries(cfg.groups)) {
    if (!g.template) continue;
    // An example whose template directory is empty documents nothing, and
    // `cloud apply` would warn about it.
    check(
      `templates/${g.template}/ has files`,
      existsSync(join(dir, "templates", g.template)) &&
        (await readdir(join(dir, "templates", g.template))).length > 0,
    );
    for (const instance of Object.keys(compose.services)) {
      if (!instance.startsWith(name)) continue;
      const s = compose.services[instance];
      check(
        `${instance} mounts its template where the image reads it`,
        (s?.volumes ?? []).includes(`./templates/${g.template}:/config:ro`) &&
          s?.environment?.COPY_CONFIG_DEST === "/data",
        (s?.volumes ?? []).join(", "),
      );
    }
  }

  // The proxy config file and the file compose mounts must be the same file.
  // Rendering velocity.toml for a BungeeCord proxy produced a network that
  // started cleanly and rejected every login.
  const configFile = proxyConfigFile(cfg.proxy.software);
  const proxyVolumes = compose.services.proxy?.volumes ?? [];
  check(
    `proxy mounts ${configFile}`,
    proxyVolumes.some((v) => v.startsWith(`./${configFile}:`)),
    proxyVolumes.join(", "),
  );
  check(
    "the other proxy config is not generated",
    !(configFile in generatedFiles(cfg)) ||
      Object.keys(generatedFiles(cfg)).filter((f) => f.startsWith("proxy/") && !f.includes("patches"))
        .length === 1,
    Object.keys(generatedFiles(cfg)).join(", "),
  );

  if (wiring.usesSecret) {
    check(
      "backends carry the forwarding secret",
      backends.every((b) =>
        String(b[1].environment?.CFG_FORWARDING_SECRET ?? "").includes(
          "FORWARDING_SECRET",
        ),
      ),
    );
  } else {
    check(
      "no secret is referenced when the mode has none",
      backends.every((b) => !b[1].environment?.CFG_FORWARDING_SECRET),
    );
  }

  if (wiring.velocityEnabled || wiring.bungeeEnabled) {
    check(
      "paper online-mode mirrors network.online",
      backends.every(
        ([, s]) =>
          s.environment?.CFG_VELOCITY_ONLINE_MODE === String(cfg.network.online),
      ),
    );
    // The online-mode pair: modern and legacy forwarding are mutually
    // exclusive. Both on, or both off, breaks login or skins.
    check(
      "exactly one forwarding style is enabled on backends",
      backends.every(
        ([, s]) =>
          (s.environment?.CFG_VELOCITY_ENABLED === "true") !==
          (s.environment?.CFG_BUNGEE_ENABLED === "true"),
      ),
      backends
        .map(
          ([n, s]) =>
            `${n}: velocity=${s.environment?.CFG_VELOCITY_ENABLED} bungee=${s.environment?.CFG_BUNGEE_ENABLED}`,
        )
        .join("; "),
    );
    check(
      "backend forwarding style matches the proxy's",
      backends.every(
        ([, s]) =>
          s.environment?.CFG_VELOCITY_ENABLED === String(wiring.velocityEnabled) &&
          s.environment?.CFG_BUNGEE_ENABLED === String(wiring.bungeeEnabled),
      ),
    );

    // PATCH_DEFINITIONS treats each file in the directory as ONE patch set.
    // Only file, ops and file-format are valid at the top level; a "patches"
    // wrapper is rejected at container start.
    const VALID_TOP = new Set(["file", "ops", "file-format"]);
    const patchFiles = renderPaperPatches(cfg);
    const targets: string[] = [];
    for (const [name, body] of Object.entries(patchFiles)) {
      const parsedPatch = JSON.parse(body) as Record<string, unknown>;
      const bad = Object.keys(parsedPatch).filter((k) => !VALID_TOP.has(k));
      check(`${name} has only valid top-level keys`, bad.length === 0, bad.join(", "));
      check(`${name} declares a target file`, typeof parsedPatch.file === "string");
      targets.push(String(parsedPatch.file));
    }
    check("patches configure spigot.yml", targets.includes("/data/spigot.yml"));
    check(
      "patches configure paper-global.yml",
      targets.includes("/data/config/paper-global.yml"),
    );
    // The secret belongs in exactly one generated file, and only in the mode
    // that uses it. Bungeeguard's token is the plugin's business.
    const paperBody = patchFiles["paper-global.json"] ?? "";
    check(
      "paper-global.yml carries the secret only under modern forwarding",
      paperBody.includes("velocity.secret") === wiring.velocityEnabled,
    );
  }

  if (cfg.proxy.software === "velocity") {
    const velocity = renderVelocityToml(cfg);
    check(
      "velocity forwarding mode matches config",
      velocity.includes(`player-info-forwarding-mode = "${cfg.network.forwarding}"`),
    );
    check(
      "velocity references a secret file only when there is one",
      velocity.includes("forwarding-secret-file") === wiring.usesSecret,
    );
    const fallbackGroup = Object.entries(cfg.groups).find(([, g]) => g.fallback);
    check("exactly one fallback group", !!fallbackGroup);
    check(
      "velocity try[] points at the fallback",
      !!fallbackGroup && velocity.includes(`try = ["${fallbackGroup[0]}`),
    );
    // Every instance of the fallback group must be listed, or a rolling
    // update takes down the one server its own failover list points at.
    if (fallbackGroup) {
      const expected = instanceNames(fallbackGroup[0], fallbackGroup[1].min);
      const tryLine = velocity.split("\n").find((l) => l.startsWith("try = "));
      check(
        "velocity try[] lists every fallback instance",
        expected.every((i) => tryLine?.includes(`"${i}"`)),
        `${tryLine} vs ${expected.join(", ")}`,
      );
    }
    check(
      "every backend is registered with the proxy",
      backends.every(([n]) => velocity.includes(`${n} = `)),
    );
  } else {
    const bungee = parseYaml(renderBungeeConfig(cfg)) as {
      servers: Record<string, { address: string }>;
      listeners: { priorities: string[] }[];
      ip_forward: boolean;
    };
    check("bungee config is valid YAML with servers", !!bungee.servers);
    check(
      "every backend is registered with the proxy",
      backends.every(([n]) => !!bungee.servers[n]),
      Object.keys(bungee.servers).join(", "),
    );
    const fallbackGroup = Object.entries(cfg.groups).find(([, g]) => g.fallback);
    check("exactly one fallback group", !!fallbackGroup);
    check(
      "bungee priorities point at the fallback",
      !!fallbackGroup &&
        !!bungee.listeners[0]?.priorities[0]?.startsWith(fallbackGroup[0]),
      bungee.listeners[0]?.priorities.join(", "),
    );
    // As above: a rollout must always have a sibling to send players to.
    if (fallbackGroup) {
      const expected = instanceNames(fallbackGroup[0], fallbackGroup[1].min);
      check(
        "bungee priorities list every fallback instance",
        expected.every((i) => bungee.listeners[0]?.priorities.includes(i)),
        `${bungee.listeners[0]?.priorities.join(", ")} vs ${expected.join(", ")}`,
      );
    }
    // BungeeCord forwarding is ip_forward. Off, backends see the proxy's IP
    // and every player gets the same offline UUID.
    check("bungee ip_forward is on", bungee.ip_forward === true);
  }

  // A rolling update is only survivable if every instance it takes down has a
  // sibling in the proxy's failover list. Both come from instanceNames, and
  // this is the assertion that keeps them from drifting apart.
  for (const { group, instances } of rollingPlan(cfg)) {
    if (!cfg.groups[group].fallback) continue;
    check(
      `${group} can be cycled without stranding players`,
      instances.length > 1,
      `${instances.length} instance(s)`,
    );
  }

  // Storage mode must actually change where persistent data lives.
  const staticGroups = Object.entries(cfg.groups).filter(([, g]) => g.static);
  if (staticGroups.length) {
    const [sname] = staticGroups[0];
    const mounts = compose.services[sname]?.volumes ?? [];
    const expected =
      cfg.network.storage === "bind" ? `./data/${sname}:/data` : `${sname}-data:/data`;
    check(
      `static group honours storage = "${cfg.network.storage}"`,
      mounts.includes(expected),
      `got: ${mounts.join(", ")}`,
    );
  }

  // Rendering must be a pure function of the config — same input, same bytes,
  // on every platform. No process.platform checks in the renderers.
  check("render is deterministic", renderCompose(cfg) === renderCompose(cfg));

  // The checked-in artifacts are documentation. Stale ones teach the wrong
  // thing, so they are verified rather than trusted. `bun run examples` fixes.
  for (const [rel, body] of Object.entries(generatedFiles(cfg))) {
    const abs = join(dir, rel);
    const onDisk = existsSync(abs) ? await readFile(abs, "utf8") : null;
    check(
      `${rel} matches the renderer`,
      onDisk === body,
      onDisk === null ? "missing — run `bun run examples`" : "stale — run `bun run examples`",
    );
  }
}

// Every preset must produce a valid config from a minimal base, and must not
// mutate its input. Presets are pure data with no privileges — this is what
// enforces that.
console.log("\npresets");
{
  const { PRESETS } = await import("../packages/cli/src/presets/registry.ts");
  const { applyPreset } = await import("../packages/cli/src/presets/types.ts");
  const base = CloudConfigSchema.parse({
    network: { name: "test" },
    groups: { lobby: { version: "1.21.10", fallback: true } },
  });
  for (const [name, preset] of Object.entries(PRESETS)) {
    const snapshot = JSON.stringify(base);
    let merged: unknown;
    try {
      merged = applyPreset(base, preset);
    } catch (err) {
      check(`${name} applies`, false, (err as Error).message);
      continue;
    }
    check(`${name} does not mutate input`, JSON.stringify(base) === snapshot);
    const ok = CloudConfigSchema.safeParse(merged);
    check(
      `${name} produces a valid config`,
      ok.success,
      ok.success ? "" : ok.error.issues.map((i) => i.message).join("; "),
    );
    check(`${name} has a description`, !!preset.description);
    // A preset may open a port on the proxy and nowhere else. Backends having
    // no published port is the security model, and a preset gets no exemption.
    if (ok.success) {
      const services = (
        parseYaml(renderCompose(ok.data)) as {
          services: Record<string, { ports?: string[] }>;
        }
      ).services;
      const opened = Object.entries(services)
        .filter(([, s]) => s.ports?.length)
        .map(([n]) => n);
      check(
        `${name} opens ports on the proxy only`,
        opened.length <= 1 && (opened[0] ?? "proxy") === "proxy",
        opened.join(", "),
      );
    }
    // Applying twice must be a no-op, or `cloud add` would duplicate plugins.
    if (ok.success && !preset.groups) {
      const twice = applyPreset(ok.data, preset);
      check(
        `${name} is idempotent`,
        JSON.stringify(twice) === JSON.stringify(ok.data),
      );
    }
  }
}

console.log("");
if (failures) {
  console.error(`${failures} invariant(s) failed`);
  process.exit(1);
}
console.log("all invariants hold");
