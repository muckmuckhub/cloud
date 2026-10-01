import type { CloudConfig } from "../types.ts";

export function tomlString(s: string): string {
  return JSON.stringify(s);
}

export function tomlValue(v: unknown): string {
  if (typeof v === "string") return tomlString(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  throw new Error(`cannot serialise ${typeof v} to TOML`);
}

/**
 * Emits cloud.toml. Unlike the other renderers this output IS meant to be
 * hand-edited, so it carries comments and omits defaults that would just be
 * noise.
 *
 * Used whole only for a new file (`cloud init`). Changes to an existing one go
 * through edit.ts, which keeps what the user wrote — the blocks below are
 * exported so that a table it has to add looks exactly as init would write it.
 */
export function renderCloudToml(cfg: CloudConfig): string {
  const out: string[] = [];

  out.push("# The only file you edit. Everything else is generated from it.");
  out.push("# Run `cloud apply` after changing anything here.");
  out.push("");

  out.push("[network]");
  out.push(`name       = ${tomlString(cfg.network.name)}`);
  out.push(`entry_port = ${cfg.network.entry_port}`);
  out.push(`motd       = ${tomlString(cfg.network.motd)}`);
  out.push(`forwarding = ${tomlString(cfg.network.forwarding)}`);
  out.push(`online     = ${cfg.network.online}`);
  if (cfg.network.domain) {
    out.push(`domain     = ${tomlString(cfg.network.domain)}`);
  }
  if (cfg.network.storage !== "bind") {
    out.push(`storage    = ${tomlString(cfg.network.storage)}   # faster on Windows/macOS`);
  }
  out.push("");

  out.push(...proxyBlock(cfg.proxy));
  out.push("");

  for (const [name, g] of Object.entries(cfg.groups)) {
    out.push(...groupBlock(name, g));
    out.push("");
  }

  return out.join("\n");
}

/** The [proxy] table, followed by [proxy.env] when there is any. */
export function proxyBlock(proxy: CloudConfig["proxy"]): string[] {
  const out: string[] = [];
  out.push("[proxy]");
  out.push(`software = ${tomlString(proxy.software)}`);
  out.push(`version  = ${tomlString(proxy.version)}`);
  out.push(`memory   = ${tomlString(proxy.memory)}`);
  if (proxy.memory_limit) {
    out.push(`memory_limit = ${tomlString(proxy.memory_limit)}`);
  }
  if (proxy.java) out.push(`java     = ${proxy.java}`);
  if (proxy.pin) out.push(`pin      = ${tomlString(proxy.pin)}`);
  if (proxy.plugins.length) out.push(`plugins  = ${tomlValue(proxy.plugins)}`);
  if (proxy.modrinth.length) out.push(`modrinth = ${tomlValue(proxy.modrinth)}`);
  if (proxy.hangar.length) out.push(`hangar   = ${tomlValue(proxy.hangar)}`);
  if (proxy.ports.length) {
    out.push(`ports    = ${tomlValue(proxy.ports)}   # published alongside entry_port`);
  }
  if (Object.keys(proxy.env).length) {
    out.push("");
    out.push(...envBlock("proxy.env", proxy.env));
  }
  return out;
}

/** One [groups.<name>] table, followed by its env table when there is one. */
export function groupBlock(name: string, g: CloudConfig["groups"][string]): string[] {
  const out: string[] = [];
  out.push(`[groups.${name}]`);
  out.push(`software = ${tomlString(g.software)}`);
  out.push(`version  = ${tomlString(g.version)}`);
  out.push(`memory   = ${tomlString(g.memory)}`);
  if (g.memory_limit) {
    out.push(`memory_limit = ${tomlString(g.memory_limit)}`);
  }
  if (g.java) out.push(`java     = ${g.java}`);
  if (g.pin) out.push(`pin      = ${tomlString(g.pin)}`);
  out.push(`min      = ${g.min}`);
  if (g.fallback) {
    out.push(`fallback = true              # players land here`);
  }
  if (g.static) {
    out.push(`static   = true              # keeps its world across restarts`);
  }
  if (g.template) out.push(`template = ${tomlString(g.template)}`);
  if (g.plugins.length) out.push(`plugins  = ${tomlValue(g.plugins)}`);
  if (g.modrinth.length) out.push(`modrinth = ${tomlValue(g.modrinth)}`);
  if (g.hangar.length) out.push(`hangar   = ${tomlValue(g.hangar)}`);
  if (Object.keys(g.env).length) {
    out.push("");
    out.push(...envBlock(`groups.${name}.env`, g.env));
  }
  return out;
}

/** An environment table: `[<table>]` and one string per line. */
export function envBlock(table: string, env: Record<string, string>): string[] {
  return [`[${table}]`, ...Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`)];
}
