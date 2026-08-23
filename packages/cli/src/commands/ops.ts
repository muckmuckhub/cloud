import { loadConfig, requireRoot } from "../config.ts";
import {
  compose,
  rcon,
  status as dockerStatus,
  waitForHealthy,
} from "../docker.ts";
import { instanceNames } from "../render/compose.ts";
import { c, confirm, fail, info, table, sym } from "../ui.ts";
import { hasFlag, optionValue, positionals } from "../args.ts";

function contextOf(argv: string[]): string | undefined {
  return optionValue(argv, "--context");
}

export async function status(argv: string[]): Promise<void> {
  const root = requireRoot();
  const cfg = await loadConfig(root);
  const rows = await dockerStatus(root, contextOf(argv));

  info(
    `${c.bold(cfg.network.name)} ${c.dim(
      `· port ${cfg.network.entry_port} · ${cfg.network.forwarding} forwarding`,
    )}`,
  );
  info("");
  info(
    table(
      rows.map((r) => ({
        service: r.name,
        state: r.state === "running" ? c.green(r.state) : c.yellow(r.state),
        health: r.health,
        uptime: r.uptime,
      })),
      ["service", "state", "health", "uptime"],
    ),
  );

  const declared = new Set(["proxy"]);
  for (const [g, group] of Object.entries(cfg.groups)) {
    for (const n of instanceNames(g, group.min)) declared.add(n);
  }
  const running = new Set(rows.filter((r) => r.state === "running").map((r) => r.name));
  const missing = [...declared].filter((d) => !running.has(d));
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
