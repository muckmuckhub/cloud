/**
 * The AI layer is optional by design. Every command must work with no
 * provider configured — `cloud init` falls back to a plain prompt wizard,
 * and `apply`/`status`/`logs` never touch a model at all.
 *
 * Consequences that follow from that:
 *   - no API key is ever bundled or required
 *   - a local model (Ollama) is a first-class option, not an afterthought
 *   - tool schemas stay simple enough for a small local model to fill
 */

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface Provider {
  readonly id: string;
  readonly model: string;
  /** Returns either a tool call or plain text. */
  complete(args: {
    system: string;
    messages: Turn[];
    tools: ToolDef[];
  }): Promise<{ text?: string; tool?: ToolCall }>;
}

export class NoProviderError extends Error {
  constructor() {
    super(
      "no AI provider configured.\n" +
        "  Set ANTHROPIC_API_KEY, or run a local model with Ollama and set\n" +
        "  CLOUD_AI_PROVIDER=ollama. Everything else works without either.",
    );
  }
}

export async function resolveProvider(): Promise<Provider | null> {
  const explicit = process.env.CLOUD_AI_PROVIDER;
  if (explicit === "none") return null;

  if (explicit === "ollama" || (!explicit && process.env.OLLAMA_HOST)) {
    const { OllamaProvider } = await import("./ollama.ts");
    return new OllamaProvider();
  }
  if (explicit === "anthropic" || process.env.ANTHROPIC_API_KEY) {
    const { AnthropicProvider } = await import("./anthropic.ts");
    return new AnthropicProvider();
  }
  return null;
}
