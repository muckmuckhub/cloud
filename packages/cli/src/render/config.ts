import type { CloudConfig } from "../types.ts";

function tomlString(s: string): string {
  return JSON.stringify(s);
}

function tomlValue(v: unknown): string {
  if (typeof v === "string") return tomlString(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  throw new Error(`cannot serialise ${typeof v} to TOML`);
}

/**
 * Emits cloud.toml. Unlike the other renderers this output IS meant to be
 * hand-edited, so it carries comments and omits defaults that would just be
 * noise.
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

  out.push("[proxy]");
  out.push(`software = ${tomlString(cfg.proxy.software)}`);
  out.push(`version  = ${tomlString(cfg.proxy.version)}`);
  out.push(`memory   = ${tomlString(cfg.proxy.memory)}`);
  if (cfg.proxy.memory_limit) {
    out.push(`memory_limit = ${tomlString(cfg.proxy.memory_limit)}`);
  }
  if (cfg.proxy.java) out.push(`java     = ${cfg.proxy.java}`);
  if (cfg.proxy.pin) out.push(`pin      = ${tomlString(cfg.proxy.pin)}`);
  if (cfg.proxy.plugins.length) {
    out.push(`plugins  = ${tomlValue(cfg.proxy.plugins)}`);
  }
  if (cfg.proxy.modrinth.length) {
    out.push(`modrinth = ${tomlValue(cfg.proxy.modrinth)}`);
  }
  if (cfg.proxy.hangar.length) {
    out.push(`hangar   = ${tomlValue(cfg.proxy.hangar)}`);
  }
  if (cfg.proxy.ports.length) {
    out.push(`ports    = ${tomlValue(cfg.proxy.ports)}   # published alongside entry_port`);
  }
  if (Object.keys(cfg.proxy.env).length) {
    out.push("");
    out.push("[proxy.env]");
    for (const [k, v] of Object.entries(cfg.proxy.env)) {
      out.push(`${k} = ${tomlString(v)}`);
    }
  }
  out.push("");

  for (const [name, g] of Object.entries(cfg.groups)) {
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
      out.push(`[groups.${name}.env]`);
      for (const [k, v] of Object.entries(g.env)) {
        out.push(`${k} = ${tomlString(v)}`);
      }
    }
    out.push("");
  }

  return out.join("\n");
}
