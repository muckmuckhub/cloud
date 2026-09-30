import { loadConfig, requireRoot } from "../config.ts";
import {
  compose,
  parsePlayerList,
  rcon,
  status as dockerStatus,
  waitForHealthy,
  type PlayerList,
} from "../docker.ts";
import { instanceNames } from "../render/compose.ts";
import { c, confirm, fail, info, table, sym } from "../ui.ts";
import { hasFlag, optionValue, positionals } from "../args.ts";

function contextOf(argv: string[]): string | undefined {
  return optionValue(argv, "--context");
}

/**
 * Asks every running backend for its player list, in parallel.
 *
 * Only backends: Velocity and BungeeCord have no RCON. A server that is still
 * booting, has RCON off, or takes too long answers null — `status` is how you
 * find out something is wrong, so it must not fail because something is.
 */
async function playerCounts(
  root: string,
  services: string[],
  context: string | undefined,
): Promise<Map<string, PlayerList | null>> {
  const results = await Promise.allSettled(
    services.map((s) => rcon(root, s, "list", context, 10_000)),
  );
  return new Map(
    services.map((s, i) => {
      const r = results[i];
      return [s, r.status === "fulfilled" ? parsePlayerList(r.value) : null];
    }),
  );
}

export async function status(argv: string[]): Promise<void> {
  const root = requireRoot();
  const cfg = await loadConfig(root);
  const context = contextOf(argv);
  const json = hasFlag(argv, "--json");
  const rows = await dockerStatus(root, context);

  const groupOf = new Map<string, string>();
  for (const [g, group] of Object.entries(cfg.groups)) {
    for (const n of instanceNames(g, group.min)) groupOf.set(n, g);
  }
  const declared = ["proxy", ...groupOf.keys()];
  const running = new Set(rows.filter((r) => r.state === "running").map((r) => r.name));
  const missing = declared.filter((d) => !running.has(d));
  const players = await playerCounts(
    root,
    rows.filter((r) => r.state === "running" && groupOf.has(r.name)).map((r) => r.name),
    context,
  );

  if (json) {
    // A stable contract for scripts and monitoring: bump `version` if a field
    // changes meaning or goes away. Nothing but JSON on stdout.
    console.log(
      JSON.stringify(
        {
          version: 1,
          network: cfg.network.name,
          entry_port: cfg.network.entry_port,
          forwarding: cfg.network.forwarding,
          services: rows.map((r) => ({
            name: r.name,
            group: groupOf.get(r.name) ?? null,
            state: r.state,
            health: r.health === "-" ? null : r.health,
            uptime: r.uptime,
            players: players.get(r.name) ?? null,
          })),
          missing,
        },
        null,
        2,
      ),
    );
    return;
  }

  info(
    `${c.bold(cfg.network.name)} ${c.dim(
      `· port ${cfg.network.entry_port} · ${cfg.network.forwarding} forwarding`,
    )}`,
  );
  info("");
  info(
    table(
      rows.map((r) => {
        const p = players.get(r.name);
        return {
          service: r.name,
          state: r.state === "running" ? c.green(r.state) : c.yellow(r.state),
          health: r.health,
          players: p ? `${p.online}/${p.max}` : "-",
          uptime: r.uptime,
        };
      }),
      ["service", "state", "health", "players", "uptime"],
    ),
  );

  const counted = [...players.values()].filter((p): p is PlayerList => !!p);
  if (counted.length) {
    const total = counted.reduce((sum, p) => sum + p.online, 0);
    info("");
    info(c.dim(`  ${total} player${total === 1 ? "" : "s"} online`));
  }

  if (missing.length) {
    info("");
    info(c.yellow(`  not running: ${missing.join(", ")}`));
    info(c.dim(`  try: cloud logs ${missing[0]}`));
  }
}

export async function logs(argv: string[]): Promise<void> {
  const root = requireRoot();
  const follow = hasFlag(argv, "-f", "--follow");
  const service = positionals(argv)[0] ?? "proxy";
  const args = ["logs", "--tail", "200"];
  if (follow) args.push("-f");
  args.push(service);
  await compose(root, args, { context: contextOf(argv) });
}

export async function exec(argv: string[]): Promise<void> {
  const root = requireRoot();
  const [service, ...rest] = positionals(argv);
  if (!service || !rest.length) {
    fail(`usage: cloud exec <server> "<minecraft command>"`);
  }
  const out = await rcon(root, service, rest.join(" "), contextOf(argv));
  info(out || c.dim("(no output)"));
}

export async function restart(argv: string[]): Promise<void> {
  const root = requireRoot();
  const cfg = await loadConfig(root);
  const context = contextOf(argv);
  const rolling = hasFlag(argv, "--rolling");
  const target = positionals(argv)[0];

  if (rolling) {
    if (!target || !cfg.groups[target]) {
      fail("--rolling needs a group name, e.g. `cloud restart lobby --rolling`");
    }
    const instances = instanceNames(target, cfg.groups[target].min);
    if (instances.length < 2) {
      info(
        c.yellow(
          `  ${target} runs one instance, so this is a restart with an outage.\n` +
            `  Nothing can catch its players — set min = 2 or higher to change that.`,
        ),
      );
    }
    for (const inst of instances) {
      info(`${c.dim("restarting")} ${inst}`);
      await compose(root, ["restart", inst], { context });
      // Wait for the instance to be ready again before taking the next one
      // down, so there is always somewhere to fall back to. This used to be a
      // fixed 15s sleep, which is shorter than a Paper boot — so the next
      // instance went down while this one was still starting, and the players
      // the failover was meant to catch were dropped.
      const waited = await waitForHealthy(root, inst, { context });
      info(`  ${c.green(sym.ok)} ${inst} ${c.dim(`ready in ${Math.round(waited / 1000)}s`)}`);
    }
    info(`${c.green(sym.ok)} rolling restart of ${target} complete`);
    return;
  }

  await compose(root, ["restart", ...(target ? [target] : [])], { context });
  info(`${c.green(sym.ok)} restarted ${target ?? "everything"}`);
}

export async function down(argv: string[]): Promise<void> {
  const root = requireRoot();
  const context = contextOf(argv);
  const purge = hasFlag(argv, "--volumes");
  const yes = hasFlag(argv, "-y", "--yes");

  if (purge && !yes) {
    info(
      c.red(
        "  --volumes deletes every world and every server file managed by this network.",
      ),
    );
    if (!(await confirm(c.bold("Really delete all data?"), false))) {
      info("Aborted.");
      return;
    }
  }
  await compose(root, ["down", ...(purge ? ["--volumes"] : [])], { context });
  info(`${c.green(sym.ok)} stopped`);
}
