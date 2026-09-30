#!/usr/bin/env node
import { ConfigError } from "./config.ts";
import { DockerError } from "./docker.ts";
import { NoProviderError } from "./ai/provider.ts";
import { c } from "./ui.ts";

const VERSION = "0.1.0";

const HELP = `${c.bold("cloud")} — Minecraft networks from one config file

${c.dim("USAGE")}
  cloud <command> [options]

${c.dim("SETUP")}
  init                 Create cloud.toml (conversational if an AI provider is set)
  init --manual        Skip the AI wizard and answer prompts yourself
  apply                Render generated files, show the diff, reconcile
  apply --dry-run      Show what would change and stop
  apply --rolling      Update multi-instance groups one instance at a time
  apply --rotate-secret  New forwarding secret, then restart everything
  add [preset]         Add a community preset. No argument lists them.

${c.dim("OPERATE")}
  status [--json]      What is running, with player counts
  logs [server] [-f]   Tail logs (defaults to the proxy)
  exec <server> "<cmd>"  Run a Minecraft console command via RCON
  restart [server]     Restart one service or everything
  restart <group> --rolling   Restart a group one instance at a time
  down [--volumes]     Stop the network (--volumes also deletes worlds)

${c.dim("ASSISTED")} ${c.dim("(optional — needs an AI provider)")}
  ask "<request>"      Propose a config change as a diff. Never applies it.
  explain <server>     Read the logs and say what went wrong

${c.dim("OPTIONS")}
  --context <name>     Target a remote host via a Docker context
  -y, --yes            Skip confirmation prompts
  -h, --help           This
  -v, --version        Print version

${c.dim("AI IS OPTIONAL")}
  Everything except ask/explain works with no provider configured.
  Set ANTHROPIC_API_KEY, or CLOUD_AI_PROVIDER=ollama for a local model.
`;

async function main(): Promise<void> {
  const [, , cmd, ...argv] = process.argv;

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(HELP);
    return;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(VERSION);
    return;
  }

  switch (cmd) {
    case "init":
      return (await import("./commands/init.ts")).init(argv);
    case "apply":
      return (await import("./commands/apply.ts")).apply(argv);
    case "add":
      return (await import("./commands/add.ts")).add(argv);
    case "status":
      return (await import("./commands/ops.ts")).status(argv);
    case "logs":
      return (await import("./commands/ops.ts")).logs(argv);
    case "exec":
      return (await import("./commands/ops.ts")).exec(argv);
    case "restart":
      return (await import("./commands/ops.ts")).restart(argv);
    case "down":
      return (await import("./commands/ops.ts")).down(argv);
    case "ask":
      return (await import("./commands/ai.ts")).askCmd(argv);
    case "explain":
      return (await import("./commands/ai.ts")).explainCmd(argv);
    default:
      console.error(`${c.red("error")} unknown command: ${cmd}`);
      console.error(`Run ${c.bold("cloud --help")} for the list.`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  if (
    err instanceof ConfigError ||
    err instanceof DockerError ||
    err instanceof NoProviderError
  ) {
    console.error(`${c.red("error")} ${err.message}`);
    process.exit(1);
  }
  console.error(`${c.red("error")} ${(err as Error).message ?? err}`);
  if (process.env.CLOUD_DEBUG) console.error(err);
  else console.error(c.dim("  (set CLOUD_DEBUG=1 for a stack trace)"));
  process.exit(1);
});
