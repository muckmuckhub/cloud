import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CloudConfigSchema, isMcVersion } from "@cloud/schema";
import { CONFIG_FILE, loadConfig, requireRoot } from "../config.ts";
import { watchBoot } from "../boot.ts";
import { formatDiff } from "../diff.ts";
import { editCloudToml } from "../edit.ts";
import { instanceNames, serverFilesDir } from "../render/compose.ts";
import { downgrades, withVersion } from "../version.ts";
import {
  createHostDirs,
  emptyTemplates,
  fixOwnership,
  memoryBudget,
  memoryWarning,
  plan,
  recreatedAtOnce,
  rollingPlan,
  seedBungeeGuard,
  seedNeoForge,
  summarise,
  writeChanges,
} from "../plan.ts";
import { ensureSecret, readSecret, rotateSecret, writeProxyToken } from "../secret.ts";
import { wiringFor } from "../render/forwarding.ts";
import {
  compose,
  engineMemoryMiB,
  publishedPorts,
  waitForHealthy,
} from "../docker.ts";
import { overrideFile, portWarnings } from "../overrides.ts";
import { c, confirm, fail, info, sym, warn } from "../ui.ts";
import { platformNotes } from "../platform.ts";
import type { CloudConfig } from "../types.ts";
import { hasFlag, optionValue } from "../args.ts";

export async function apply(argv: string[]): Promise<void> {
  const root = requireRoot();
  let cfg = await loadConfig(root);
  const dryRun = hasFlag(argv, "--dry-run", "-n");
  const yes = hasFlag(argv, "-y", "--yes");
  const rotate = hasFlag(argv, "--rotate-secret");
  const rolling = hasFlag(argv, "--rolling");
  const recreate = hasFlag(argv, "--recreate");
  const wait = !hasFlag(argv, "--no-wait");
  const versionArg = optionValue(argv, "--version");
  const context = optionValue(argv, "--context");

  if (recreate && rolling) {
    fail("--recreate throws every server away; there is nothing to roll. Use one or the other.");
  }

  // --version is an edit to cloud.toml, made here and shown as a diff, so the
  // file stays the one place that says what runs. It is written only after
  // the confirmation below, together with everything else.
  let newToml: string | null = null;
  if (versionArg) {
    const switched = switchVersion(cfg, versionArg, await readFile(join(root, CONFIG_FILE), "utf8"));
    const down = downgrades(cfg, switched.cfg);
    // Only a network that has run has worlds to break.
    if (down.length && !recreate && existsSync(join(root, "docker-compose.yml"))) {
      fail(
        `Minecraft cannot open a world saved by a newer version:\n` +
          down.map((d) => `    ${d.group}: ${d.from} → ${d.to}`).join("\n") +
          `\n  Its servers would stop at startup and crash-loop. To start over with new\n` +
          `  worlds on ${versionArg}, add --recreate (it deletes the current ones).`,
      );
    }
    if (switched.text !== switched.prevText) {
      info(c.bold(CONFIG_FILE));
      info(formatDiff(switched.prevText, switched.text));
      info("");
      newToml = switched.text;
    } else {
      info(c.dim(`Every group already runs ${versionArg}.`));
    }
    cfg = switched.cfg;
  }

  // Rotation is a flag on apply rather than its own command: the new secret is
  // useless until every backend restarts, and apply is what restarts them.
  const wiring = wiringFor(cfg.network.forwarding);
  if (rotate && !wiring.usesSecret) {
    fail(
      `forwarding = "${cfg.network.forwarding}" uses no secret, so there is ` +
        `nothing to rotate.`,
    );
  }
  if (wiring.usesSecret) {
    if (rotate) {
      if (dryRun) {
        fail("--rotate-secret writes a new secret, so it cannot be a dry run.");
      }
      if (
        !yes &&
        !(await confirm(
          "Rotate the forwarding secret? Every backend restarts.",
          false,
        ))
      ) {
        info("Aborted. The secret is unchanged.");
        return;
      }
      await rotateSecret(root);
      info(`${c.green(sym.ok)} rotated proxy/forwarding.secret`);
    } else if (dryRun) {
      // A dry run must not touch the filesystem, secret included — otherwise
      // `apply --dry-run` in a fresh directory leaves state behind.
      if (!(await readSecret(root))) {
        info(c.dim(`  would generate proxy/forwarding.secret`));
      }
    } else {
      const [, created] = await ensureSecret(root);
      if (created) {
        info(`${c.green(sym.ok)} generated proxy/forwarding.secret`);
      }
    }
  }

  for (const note of platformNotes(root)) info(c.dim(`  ${note}`));

  const changes = await plan(root, cfg);
  if (changes.length) {
    info(summarise(root, changes));
  } else {
    info(c.dim("Generated files are already up to date."));
  }

  // Recreating three lobbies at once is an outage nobody asked for. Say so
  // while it is still avoidable — which includes during a dry run, since that
  // is where someone looks before deciding how to run the real thing.
  // Not with --recreate: everything is being thrown away on purpose.
  if (!rolling && !recreate) {
    const cyclable = recreatedAtOnce(changes, cfg);
    if (cyclable.length) {
      info(
        c.yellow(
          `  ${cyclable
            .map((g) => `${g.group} (${g.instances.length})`)
            .join(", ")} will be recreated at once — every player on them drops.\n` +
            `  Use \`cloud apply --rolling\` to cycle them one at a time instead.`,
        ),
      );
      info("");
    }
  }

  // Before the confirmation, like the warning above: an oversized network
  // starts fine and only fails an hour later, so this is the last moment the
  // problem is visible. Silent if the engine cannot be asked.
  const engineMiB = await engineMemoryMiB(context);
  const tooBig = engineMiB && memoryWarning(memoryBudget(cfg), engineMiB);
  if (tooBig) warn(tooBig);

  if (recreate) {
    info(
      c.red(
        "  --recreate deletes every world and server file of this network, then builds\n" +
          "  it again from cloud.toml. Plugin and mod config directories are kept.",
      ),
    );
  }

  if (dryRun) {
    info(c.dim("--dry-run: stopping before writing."));
    return;
  }

  if (recreate && !yes) {
    if (!(await confirm(c.bold("Really delete all worlds and start over?"), false))) {
      info("Aborted. Nothing changed.");
      return;
    }
  } else if ((changes.length || newToml) && !yes) {
    if (!(await confirm("Write these files and reconcile?", true))) {
      info("Aborted.");
      return;
    }
  }

  if (newToml !== null) {
    await writeFile(join(root, CONFIG_FILE), newToml, "utf8");
    info(`${c.green(sym.ok)} wrote ${CONFIG_FILE}`);
  }
  // Before the new compose file is written: tearing down needs the old one,
  // which still names the volumes being deleted.
  if (recreate) await wipe(root, cfg, context);

  await writeChanges(root, changes);
  // Before compose, so the bind sources belong to the user and not to root.
  await createHostDirs(root, cfg);

  for (const file of await seedNeoForge(root, cfg)) {
    info(`${c.green(sym.ok)} seeded ${file}`);
  }
  if (wiring.guard) {
    for (const file of await seedBungeeGuard(root, cfg)) {
      info(`${c.green(sym.ok)} seeded ${file}`);
    }
    // Velocity reads the secret file itself; BungeeCord's plugin needs it in
    // its own token.yml, rewritten every time so a rotation reaches it.
    const secret = await readSecret(root);
    if (secret && cfg.proxy.software !== "velocity") {
      await writeProxyToken(root, secret);
    }
  }

  // Last, after everything written into the servers' directories above.
  const wrongOwner = await fixOwnership(root, cfg);
  if (wrongOwner.length) {
    const { uid, gid } = wrongOwner[0];
    warn(
      `the servers run as uid ${uid}, but cannot write to directories owned by you:\n` +
        wrongOwner.map((o) => `    ${o.dir}`).join("\n") +
        `\n  They will fail to install plugins and save files. Either hand them over:\n` +
        `    sudo chown -R ${uid}:${gid} ${wrongOwner.map((o) => o.dir).join(" ")}\n` +
        `  or run \`sudo cloud apply\`, which does it for you.`,
    );
  }

  // After createHostDirs, so a template directory that did not exist has just
  // been made and shows up as empty rather than missing — same advice either
  // way, and the folder is now there to drop files into.
  for (const name of await emptyTemplates(root, cfg)) {
    warn(
      `templates/${name}/ is empty, so it will seed nothing.\n` +
        `  Put files there mirroring the server directory, e.g.\n` +
        `    templates/${name}/plugins/LuckPerms/config.yml\n` +
        `    templates/${name}/server.properties`,
    );
  }

  // Only when an override exists: it is the only way a port we did not
  // generate can appear, and it saves a docker call for everyone else.
  const override = overrideFile(root);
  if (override) {
    info(c.dim(`  merging ${override}`));
    for (const w of portWarnings(cfg, await publishedPorts(root, context))) {
      warn(w.message);
    }
  }

  if (rolling) await rollOut(root, cfg, context);

  // `up -d --remove-orphans` IS the reconciler: it creates what is missing,
  // recreates what changed, and removes services no longer declared. After a
  // rollout the cycled instances are already converged, so this only picks up
  // the proxy, single-instance groups, and anything no longer declared.
  await compose(root, ["up", "-d", "--remove-orphans"], { context });

  const address = `${cfg.network.domain ?? "localhost"}:${cfg.network.entry_port}`;
  if (!wait) {
    info("");
    info(`${c.green(sym.ok)} containers started on port ${cfg.network.entry_port}`);
    info(c.dim(`  players can join once the servers have booted — cloud status shows when`));
    return;
  }

  // Containers starting is not a network players can join: a Paper server
  // needs a minute after that. Wait for the proxy and the fallback group to
  // actually answer, and show what each server is doing meanwhile.
  info("");
  const result = await watchBoot(root, cfg, { context });
  info("");
  if (result.joinableAfter !== null) {
    const fallback = Object.keys(cfg.groups).find((g) => cfg.groups[g].fallback);
    info(
      `${c.green(sym.ok)} ready in ${Math.round(result.joinableAfter / 1000)}s — join ${c.bold(address)}` +
        c.dim(`  (players land on ${fallback})`),
    );
  }
  if (result.failed.length) {
    fail(
      `${result.timedOut ? "not ready after 10 minutes" : "did not start"}: ${result.failed.join(", ")}\n` +
        `  See why: cloud logs ${result.failed[0]}   (or: cloud explain ${result.failed[0]})`,
    );
  }
}

/**
 * Switching every group to another Minecraft version, as an edit to the
 * text of cloud.toml — comments kept, like `cloud add`.
 */
function switchVersion(
  cfg: CloudConfig,
  version: string,
  prevText: string,
): { cfg: CloudConfig; text: string; prevText: string } {
  if (!isMcVersion(version)) {
    fail(`--version takes a Minecraft version, e.g. 1.21.10 or 26.2 — not "${version}".`);
  }
  // Through the schema, so what the version implies is checked like a hand
  // edit: the Java it needs against a pin, a FabricProxy-Lite that exists.
  const parsed = CloudConfigSchema.safeParse(withVersion(cfg, version));
  if (!parsed.success) {
    fail(
      `this network cannot run ${version} as it is:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  const edited = editCloudToml(prevText, parsed.data);
  if (!edited.inPlace) {
    warn(`${CONFIG_FILE} will be rewritten in canonical form: ${edited.reason}.`);
  }
  return { cfg: parsed.data, text: edited.text, prevText };
}

/**
 * Throws the network away for --recreate: containers and named volumes, and
 * the world data of static groups kept on the host. A static group's plugin
 * or mod config directory survives — that is the operator's configuration,
 * not world state, and rebuilding should not cost it.
 */
async function wipe(root: string, cfg: CloudConfig, context: string | undefined): Promise<void> {
  if (existsSync(join(root, "docker-compose.yml"))) {
    await compose(root, ["down", "--volumes", "--remove-orphans"], { context });
  }
  for (const [group, g] of Object.entries(cfg.groups)) {
    if (!(g.static && cfg.network.storage === "bind")) continue;
    for (const instance of instanceNames(group, g.min)) {
      const dir = join(root, "data", instance);
      if (!existsSync(dir)) continue;
      const keep = serverFilesDir(instance, g.software).host.split("/").pop();
      for (const entry of await readdir(dir)) {
        if (entry !== keep) await rm(join(dir, entry), { recursive: true, force: true });
      }
    }
  }
  info(`${c.green(sym.ok)} removed the old worlds`);
}

/**
 * Recreates multi-instance groups one instance at a time, waiting for each to
 * be ready before touching the next.
 *
 * What this does and does not buy you: players on the instance being recreated
 * are moved to a sibling by the proxy's failover list, so the group stays
 * available throughout. It cannot help with the proxy itself — there is one of
 * those, and recreating it reconnects everybody. Nor with a single-instance
 * group, which has nothing to fail over to.
 */
async function rollOut(
  root: string,
  cfg: CloudConfig,
  context: string | undefined,
): Promise<void> {
  const groups = rollingPlan(cfg);
  if (!groups.length) {
    info(
      c.yellow(
        `  --rolling has nothing to cycle: no group runs more than one instance.\n` +
          `  Set min = 2 or higher on a group to make updates survivable.`,
      ),
    );
    return;
  }

  for (const { group, instances } of groups) {
    info(c.dim(`  cycling ${group} (${instances.length} instances)`));
    for (const instance of instances) {
      // --no-deps so compose touches this one service and not the proxy.
      await compose(root, ["up", "-d", "--no-deps", instance], { context });
      const waited = await waitForHealthy(root, instance, { context });
      info(`    ${c.green(sym.ok)} ${instance} ${c.dim(`ready in ${Math.round(waited / 1000)}s`)}`);
    }
  }
}
