import type { Provider, ToolDef, ToolCall, Turn } from "./provider.ts";

/**
 * Local models via Ollama. This matters more than it looks: the people who
 * self-host Minecraft networks overlap heavily with people who already run a
 * GPU box, and "no account, no key, no cost, works offline" removes the main
 * objection to an AI feature in an open-source tool.
 */
export class OllamaProvider implements Provider {
  readonly id = "ollama";
  readonly model: string;
  #host: string;

  constructor() {
    this.#host = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(
      /\/$/,
      "",
    );
    this.model = process.env.CLOUD_AI_MODEL ?? "qwen2.5-coder:7b";
  }

  async complete(args: {
    system: string;
    messages: Turn[];
    tools: ToolDef[];
  }): Promise<{ text?: string; tool?: ToolCall }> {
    const res = await fetch(`${this.#host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: "system", content: args.system },
          ...args.messages,
        ],
        tools: args.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        })),
      }),
    }).catch((err) => {
      throw new Error(
        `cannot reach Ollama at ${this.#host}: ${err.message}\n` +
          `  Is it running? \`ollama serve\``,
      );
    });

    if (!res.ok) {
      throw new Error(`ollama returned ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      message?: {
        content?: string;
        tool_calls?: { function: { name: string; arguments: unknown } }[];
      };
    };

    const call = body.message?.tool_calls?.[0];
    if (call) {
      const raw = call.function.arguments;
      const input =
        typeof raw === "string"
          ? (JSON.parse(raw) as Record<string, unknown>)
          : (raw as Record<string, unknown>);
      return { tool: { name: call.function.name, input } };
    }
    return { text: body.message?.content ?? "" };
  }
}
