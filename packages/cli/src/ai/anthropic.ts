import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ToolDef, ToolCall, Turn } from "./provider.ts";

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  readonly model: string;
  #client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    this.#client = new Anthropic({ apiKey });
    this.model = process.env.CLOUD_AI_MODEL ?? "claude-haiku-4-5";
  }

  async complete(args: {
    system: string;
    messages: Turn[];
    tools: ToolDef[];
  }): Promise<{ text?: string; tool?: ToolCall }> {
    const res = await this.#client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: args.system,
      messages: args.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: args.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
    });

    for (const block of res.content) {
      if (block.type === "tool_use") {
        return {
          tool: {
            name: block.name,
            input: block.input as Record<string, unknown>,
          },
        };
      }
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { text };
  }
}
