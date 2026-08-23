import { zodToJsonSchema } from "zod-to-json-schema";
import { CloudConfigSchema, type CloudConfig } from "@cloud/schema";
import type { Provider, ToolDef, Turn } from "./provider.ts";
import { ask, c, info } from "../ui.ts";
import { fetchPaperVersions } from "../versions.ts";

const SYSTEM = `You are the setup assistant for a Minecraft network tool.

Your job is to turn a user's description into a valid config, asking only for
what you genuinely cannot infer.

MUST ask about:
- the public entry port, if not stated (25565 is the usual default)
- how much RAM each server should get, if not stated
- which server is the lobby/fallback, when there is more than one

MUST NOT ask about:
- backend ports. There are none. Every backend listens on 25565 inside its own
  container and is reached by name on a private Docker network.
- the forwarding secret. It is generated locally and never shown to you.
- forwarding mode. Use "modern" with Velocity, which is the default proxy. If
  the user explicitly asks for BungeeCord or Waterfall, use "bungeeguard"
  instead — "modern" is a Velocity protocol and is rejected on those.
- Java versions, image names, or online-mode settings. Those are derived.

Ask ONE question per turn, in plain language, and keep it short. When nothing
essential is missing, call emit_config. Do not call emit_config while a
required value is still a guess.

Only use Minecraft versions from the list given below. Never invent one.`;

function tools(versions: string[]): ToolDef[] {
  return [
    {
      name: "ask_user",
      description:
        "Ask the user one short question about something you cannot infer.",
      input_schema: {
        type: "object",
        properties: {
          question: { type: "string", description: "One short question." },
          suggestion: {
            type: "string",
            description: "Optional default the user can accept by pressing enter.",
          },
        },
        required: ["question"],
      },
    },
    {
      name: "emit_config",
      description:
        "Produce the final config. Call this only when nothing essential is " +
        `missing. Valid Minecraft versions: ${versions.slice(0, 12).join(", ")}`,
      input_schema: zodToJsonSchema(CloudConfigSchema, {
        target: "openApi3",
        $refStrategy: "none",
      }) as Record<string, unknown>,
    },
  ];
}

export async function runWizard(
  provider: Provider,
  prompt: string,
): Promise<CloudConfig> {
  const versions = await fetchPaperVersions();
  const messages: Turn[] = [{ role: "user", content: prompt }];
  const toolDefs = tools(versions);

  info(c.dim(`  using ${provider.id}/${provider.model}`));

  for (let turn = 0; turn < 20; turn++) {
    const res = await provider.complete({
      system: `${SYSTEM}\n\nAvailable Minecraft versions (newest first):\n${versions
        .slice(0, 20)
        .join(", ")}`,
      messages,
      tools: toolDefs,
    });

    if (res.tool?.name === "emit_config") {
      const parsed = CloudConfigSchema.safeParse(res.tool.input);
      if (parsed.success) return parsed.data;
      // Hand the validation errors back; the model gets to correct itself.
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      messages.push(
        { role: "assistant", content: "(emitted an invalid config)" },
        {
          role: "user",
          content: `That config failed validation: ${issues}. Fix it and call emit_config again.`,
        },
      );
      continue;
    }

    if (res.tool?.name === "ask_user") {
      const q = String(res.tool.input.question ?? "");
      const suggestion = res.tool.input.suggestion
        ? String(res.tool.input.suggestion)
        : undefined;
      const answer = await ask(`${c.cyan("?")} ${q}`, suggestion);
      messages.push(
        { role: "assistant", content: `(asked: ${q})` },
        { role: "user", content: answer },
      );
      continue;
    }

    // Plain text with no tool call: show it and nudge the model forward.
    if (res.text) info(c.dim(res.text));
    messages.push(
      { role: "assistant", content: res.text ?? "" },
      {
        role: "user",
        content: "Continue. Use ask_user or emit_config.",
      },
    );
  }

  throw new Error(
    "the assistant did not settle on a config after 20 turns.\n" +
      "Run `cloud init --manual` to fill it in yourself.",
  );
}
