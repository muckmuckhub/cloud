import { loadConfig, requireRoot } from "../config.ts";
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
  const cfg = await loadConfig(root);
  const dryRun = hasFlag(argv, "--dry-run", "-n");
  const yes = hasFlag(argv, "-y", "--yes");
  const rotate = hasFlag(argv, "--rotate-secret");
  const rolling = hasFlag(argv, "--rolling");
  const context = optionValue(argv, "--context");

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
  if (!rolling) {
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

  if (dryRun) {
    info(c.dim("--dry-run: stopping before writing."));
    return;
  }

  if (changes.length && !yes) {
    if (!(await confirm("Write these files and reconcile?", true))) {
      info("Aborted.");
      return;
    }
  }

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

  info("");
  info(`${c.green(sym.ok)} network is up on port ${cfg.network.entry_port}`);
  info(c.dim(`  cloud status    — see what is running`));
  info(c.dim(`  cloud logs -f   — follow the proxy`));
  info(c.dim(`  ./data/<server>/plugins — plugin files, editable from here`));
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
