import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CloudConfigSchema } from "@cloud/schema";
import { CONFIG_FILE, loadConfig, requireRoot } from "../config.ts";
import { editCloudToml } from "../edit.ts";
import { plan, summarise } from "../plan.ts";
import { compose } from "../docker.ts";
import { resolveProvider, NoProviderError } from "../ai/provider.ts";
import { fetchPaperVersions } from "../versions.ts";
import { c, confirm, fail, info, sym, warn } from "../ui.ts";
import { hasFlag, optionValue, positionals } from "../args.ts";
import { formatDiff } from "../diff.ts";

/**
 * `cloud ask` never applies anything. It proposes a new cloud.toml, shows the
 * resulting diff, and stops. A human commits. Deterministic code executes.
 */
export async function askCmd(argv: string[]): Promise<void> {
  const root = requireRoot();
  const current = await loadConfig(root);
  const request = positionals(argv).join(" ");
  if (!request) fail(`usage: cloud ask "add a creative server with 2G"`);

  const provider = await resolveProvider();
  if (!provider) throw new NoProviderError();

  const versions = await fetchPaperVersions();
  const res = await provider.complete({
    system:
      "You modify a Minecraft network config. You are given the current config " +
      "as JSON and a change request. Return the COMPLETE new config via " +
      "emit_config — not a patch. Change only what the request asks for; copy " +
      "everything else across unchanged. Exactly one group has fallback = true. " +
      'Forwarding is "modern" on Velocity and "bungeeguard" on BungeeCord or ' +
      "Waterfall; the combination modern+bungeecord is invalid. Extra published " +
      "ports go in proxy.ports — backends never publish one. " +
      `Valid Minecraft versions: ${versions.slice(0, 12).join(", ")}`,
    messages: [
      {
        role: "user",
        content: `Current config:\n${JSON.stringify(
          current,
          null,
          2,
        )}\n\nChange request: ${request}`,
      },
    ],
    tools: [
      {
        name: "emit_config",
        description: "The complete new config.",
        input_schema: zodToJsonSchema(CloudConfigSchema, {
          target: "openApi3",
          $refStrategy: "none",
        }) as Record<string, unknown>,
      },
    ],
  });

  if (res.tool?.name !== "emit_config") {
    fail(`the assistant did not produce a config.\n${res.text ?? ""}`);
  }

  const parsed = CloudConfigSchema.safeParse(res.tool.input);
  if (!parsed.success) {
    fail(
      "the assistant produced an invalid config:\n" +
        parsed.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n"),
    );
  }

  const prevToml = await readFile(join(root, CONFIG_FILE), "utf8");
  // The model returns a whole config; only what differs is written back.
  const edited = editCloudToml(prevToml, parsed.data);
  const nextToml = edited.text;
  if (nextToml === prevToml) {
    info(c.dim("No change — the config already does that."));
    return;
  }

  info(c.bold(`${CONFIG_FILE}`));
  info(formatDiff(prevToml, nextToml));

  const changes = await plan(root, parsed.data);
  if (changes.length) {
    info("");
    info(c.dim("resulting generated files:"));
    info(summarise(root, changes));
  }

  const yes = hasFlag(argv, "-y", "--yes");
  if (!edited.inPlace) {
    // Said before the question, so nobody loses their comments by surprise.
    warn(
      `${CONFIG_FILE} cannot be edited in place: ${edited.reason}.\n` +
        `  It will be rewritten in canonical form, without your comments and layout.\n` +
        `  To keep them, answer no and add the lines above by hand.`,
    );
  }
  if (!yes && !(await confirm(`Write ${CONFIG_FILE}?`, false))) {
    info("Aborted. Nothing written.");
    return;
  }
  await writeFile(join(root, CONFIG_FILE), nextToml, "utf8");
  info(`${c.green(sym.ok)} wrote ${CONFIG_FILE}`);
  info(`  next: ${c.bold("cloud apply")}`);
}

/** `cloud explain` reads logs and says what went wrong in plain language. */
export async function explainCmd(argv: string[]): Promise<void> {
  const root = requireRoot();
  const cfg = await loadConfig(root);
  const service = positionals(argv)[0];
  if (!service) fail("usage: cloud explain <server>");

  const provider = await resolveProvider();
  if (!provider) throw new NoProviderError();

  const { stdout } = await compose(root, ["logs", "--tail", "200", service], {
    stdio: "pipe",
    context: optionValue(argv, "--context"),
  });
  if (!stdout.trim()) fail(`no logs for ${service}. Is the service declared?`);

  const res = await provider.complete({
    system:
      "You diagnose Minecraft server problems from container logs. Be concise: " +
      "say what went wrong and what to change, in at most five sentences. If " +
      "the logs look healthy, say so. For UnsupportedClassVersionError, the " +
      "class file number maps to a Java version: 52=Java 8, 55=11, 61=17, " +
      "65=21, 69=25. State the correct Java versions; do not guess. " +
      "Common causes: Velocity forwarding " +
      "secret mismatch (often a trailing newline), online-mode set wrong on " +
      "backend vs proxy, a plugin needing a newer Java version than the image, " +
      "or out-of-memory. Do not invent log lines.",
    messages: [
      {
        role: "user",
        content:
          `Service: ${service}\nMinecraft: ${
            cfg.groups[service]?.version ?? "n/a"
          }\nForwarding: ${cfg.network.forwarding}\n\nLast 200 log lines:\n` +
          // Logs are attacker-influenced (plugin names, player names). They go
          // in as data to summarise, never as instructions to follow.
          stdout.slice(-12000),
      },
    ],
    tools: [],
  });

  info(res.text ?? c.dim("(no response)"));
}

