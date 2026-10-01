import { parse as parseToml } from "smol-toml";
import { CloudConfigSchema } from "@cloud/schema";
import type { CloudConfig } from "./types.ts";
import {
  envBlock,
  groupBlock,
  proxyBlock,
  renderCloudToml,
  tomlValue,
} from "./render/config.ts";

/**
 * Changing an existing cloud.toml without rewriting it.
 *
 * `cloud add` and `cloud ask` used to write the file back through the renderer,
 * which is right for a new file and wrong for one a person maintains: every
 * comment, every blank line and every custom alignment was gone after one
 * preset. This edits the text instead. It works out which values differ
 * between what the file says and what it should say, and touches only those
 * lines; everything else stays byte for byte.
 *
 * It edits the forms it understands — `[table]` headers and `key = value`
 * lines — and then proves the result: the edited text must parse to exactly
 * the config that was asked for. Anything it cannot do that way falls back to
 * the canonical rewrite and says why, so the caller can tell the user before
 * anything is written. A wrong edit never reaches disk.
 */
export interface EditResult {
  text: string;
  /** False when the file had to be rewritten in canonical form. */
  inPlace: boolean;
  /** Why it could not edit in place, for the message to the user. */
  reason?: string;
}

export type Op =
  | { kind: "set"; table: string[]; key: string; value: unknown }
  | { kind: "delete"; table: string[]; key: string }
  | { kind: "addGroup"; name: string }
  | { kind: "deleteGroup"; name: string };

class Unsupported extends Error {}

export function editCloudToml(text: string, next: CloudConfig): EditResult {
  let prev: CloudConfig;
  try {
    prev = CloudConfigSchema.parse(parseToml(text));
  } catch {
    return canonical(next, "the current cloud.toml does not parse");
  }
  const ops = diffConfigs(prev, next);
  if (!ops.length) return { text, inPlace: true };

  let edited: string;
  try {
    edited = ops.reduce((t, op) => applyOp(t, op, next), text);
  } catch (err) {
    if (err instanceof Unsupported) return canonical(next, err.message);
    throw err;
  }

  // The proof: whatever the editor produced has to mean exactly what was
  // asked for, or it is not used.
  try {
    const check = CloudConfigSchema.parse(parseToml(edited));
    if (stable(check) === stable(next)) return { text: edited, inPlace: true };
  } catch {
    // fall through to the canonical rewrite
  }
  return canonical(next, "an in-place edit did not reproduce the new config exactly");
}

function canonical(next: CloudConfig, reason: string): EditResult {
  return { text: renderCloudToml(next), inPlace: false, reason };
}

// ---- what changed -----------------------------------------------------------

/** Value-level differences between two validated configs, as edits. */
export function diffConfigs(prev: CloudConfig, next: CloudConfig): Op[] {
  const ops: Op[] = [];
  const table = (path: string[], a: object, b: object, nested: string[] = []) => {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (nested.includes(key)) {
        table([...path, key], (ra[key] ?? {}) as object, (rb[key] ?? {}) as object);
        continue;
      }
      if (stable(ra[key]) === stable(rb[key])) continue;
      ops.push(
        rb[key] === undefined
          ? { kind: "delete", table: path, key }
          : { kind: "set", table: path, key, value: rb[key] },
      );
    }
  };
  table(["network"], prev.network, next.network);
  table(["proxy"], prev.proxy, next.proxy, ["env"]);
  for (const name of Object.keys(prev.groups)) {
    if (!next.groups[name]) ops.push({ kind: "deleteGroup", name });
  }
  for (const [name, g] of Object.entries(next.groups)) {
    if (!prev.groups[name]) ops.push({ kind: "addGroup", name });
    else table(["groups", name], prev.groups[name], g, ["env"]);
  }
  return ops;
}

// ---- reading the text -------------------------------------------------------

interface KeyLine {
  key: string;
  /** First and last line of the entry: equal unless the value spans lines. */
  line: number;
  lastLine: number;
  /** On a one-line entry: where the value starts and ends (before a comment). */
  valueStart: number;
  valueEnd: number;
  /** Column of the `=`, for lining up a key inserted next to it. */
  eq: number;
}

interface Section {
  path: string[];
  header: number;
  keys: KeyLine[];
}

/** First line after a section's own content — its last key, or its header. */
const contentEnd = (s: Section) => (s.keys.length ? s.keys[s.keys.length - 1].lastLine : s.header) + 1;

const BARE = /^[A-Za-z0-9_-]+$/;

/** Splits `groups."my lobby".env` into its parts, unquoting each. */
function splitDotted(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = "";
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ".") {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}

interface ScanState {
  depth: number;
  quote: string;
}

/**
 * Scans part of a line of a TOML value, carrying string and bracket state
 * across lines. Returns the column of a `#` comment outside every string and
 * bracket, or null if there is none on this line.
 */
function scan(line: string, from: number, st: ScanState): number | null {
  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (st.quote) {
      if ((st.quote === '"' || st.quote === '"""') && ch === "\\") {
        i++;
      } else if (line.startsWith(st.quote, i)) {
        i += st.quote.length - 1;
        st.quote = "";
      }
      continue;
    }
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      st.quote = line.slice(i, i + 3);
      i += 2;
    } else if (ch === '"' || ch === "'") st.quote = ch;
    else if (ch === "[" || ch === "{") st.depth++;
    else if (ch === "]" || ch === "}") st.depth--;
    else if (ch === "#" && st.depth === 0) return i;
  }
  // A single-quoted or double-quoted string cannot cross a line; a
  // triple-quoted one and an open bracket can.
  if (st.quote.length === 1) st.quote = "";
  return null;
}

/**
 * The file's tables and their keys. Throws Unsupported for what the editor
 * would have to guess about — an array of tables, a dotted key, a key outside
 * any table. Verification after editing would catch a wrong guess too; this
 * says why rather than only that it failed.
 */
function sections(lines: string[]): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[[")) throw new Unsupported("it uses an array of tables ([[...]])");
    const header = /^\[([^\]]+)\]\s*(#.*)?$/.exec(trimmed);
    if (header) {
      cur = { path: splitDotted(header[1]), header: i, keys: [] };
      out.push(cur);
      continue;
    }
    const kv = /^(\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+)(\s*)=(\s*)/.exec(line);
    if (!kv) throw new Unsupported(`line ${i + 1} is not in a form it can edit`);
    const rawKey = kv[2];
    const quoted = rawKey.startsWith('"') || rawKey.startsWith("'");
    if (!quoted && !BARE.test(rawKey)) {
      throw new Unsupported(`line ${i + 1} uses a dotted key (${rawKey})`);
    }
    if (!cur) throw new Unsupported("it has keys outside any [table]");

    const st: ScanState = { depth: 0, quote: "" };
    const start = kv[0].length;
    const comment = scan(line, start, st);
    let last = i;
    while ((st.depth > 0 || st.quote) && last + 1 < lines.length) {
      last++;
      scan(lines[last], 0, st);
    }
    cur.keys.push({
      key: quoted ? rawKey.slice(1, -1) : rawKey,
      line: i,
      lastLine: last,
      valueStart: start,
      valueEnd: (comment === null ? line : line.slice(0, comment)).trimEnd().length,
      eq: kv[1].length + rawKey.length + kv[3].length,
    });
    i = last;
  }
  return out;
}

// ---- changing the text ------------------------------------------------------

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function applyOp(text: string, op: Op, next: CloudConfig): string {
  const lines = text.split("\n");
  const secs = sections(lines);
  const find = (path: string[]) => secs.find((s) => same(s.path, path));

  switch (op.kind) {
    case "set": {
      const value = tomlValue(op.value);
      const sec = find(op.table);
      if (!sec) return insertTable(lines, secs, op.table, `${op.key} = ${value}`, next);
      const existing = sec.keys.find((k) => k.key === op.key);
      if (existing && existing.lastLine === existing.line) {
        // Only the value changes: the key, its alignment and a comment after
        // it on the same line all stay.
        const l = lines[existing.line];
        lines[existing.line] = l.slice(0, existing.valueStart) + value + l.slice(existing.valueEnd);
        return lines.join("\n");
      }
      if (existing) {
        // A value spanning lines becomes one line; the lines around it stay.
        const l = lines[existing.line];
        lines.splice(existing.line, existing.lastLine - existing.line + 1, l.slice(0, existing.valueStart) + value);
        return lines.join("\n");
      }
      // A new key goes after the table's last key, lined up with its
      // neighbours when at least two of them share one column for their `=`
      // — one key alone is not a layout anyone chose.
      const eqs = new Set(sec.keys.map((k) => k.eq));
      const col = eqs.size === 1 && sec.keys.length >= 2 ? [...eqs][0] : 0;
      const name = BARE.test(op.key) ? op.key : JSON.stringify(op.key);
      const pad = col > name.length ? " ".repeat(col - name.length) : " ";
      lines.splice(contentEnd(sec), 0, `${name}${pad}= ${value}`);
      return lines.join("\n");
    }
    case "delete": {
      const k = find(op.table)?.keys.find((k) => k.key === op.key);
      if (!k) throw new Unsupported(`it could not find ${[...op.table, op.key].join(".")}`);
      lines.splice(k.line, k.lastLine - k.line + 1);
      return lines.join("\n");
    }
    case "addGroup":
      return insertAt(lines, lines.length, groupBlock(op.name, next.groups[op.name]));
    case "deleteGroup": {
      const owned = secs.filter((s) => s.path[0] === "groups" && s.path[1] === op.name);
      if (!owned.length) throw new Unsupported(`it could not find [groups.${op.name}]`);
      // The group's tables, and the comment lines directly above its header:
      // those described the group and would now describe nothing. Comments
      // belonging to the next table, above its header, are left alone.
      let from = Math.min(...owned.map((s) => s.header));
      while (from > 0 && isComment(lines[from - 1])) from--;
      const to = Math.max(...owned.map(contentEnd));
      lines.splice(from, to - from);
      return collapseBlanks(lines).join("\n");
    }
  }
}

const isComment = (l: string) => l.trim().startsWith("#");

/**
 * A table the file does not have yet, written as init would write it and
 * placed next to its parent: a missing [proxy] before the groups, an env
 * table after its group, anything else after its siblings.
 */
function insertTable(
  lines: string[],
  secs: Section[],
  table: string[],
  line: string,
  next: CloudConfig,
): string {
  if (same(table, ["proxy"])) {
    const firstGroup = secs.find((s) => s.path[0] === "groups");
    let at = firstGroup ? firstGroup.header : lines.length;
    while (firstGroup && at > 0 && isComment(lines[at - 1])) at--;
    const block = proxyBlock(next.proxy);
    const envAt = block.indexOf("[proxy.env]");
    return insertAt(lines, at, envAt < 0 ? block : block.slice(0, envAt - 1));
  }
  const parent = table.slice(0, -1);
  const family = secs.filter((s) => same(s.path.slice(0, parent.length), parent));
  if (!family.length) throw new Unsupported(`it has no table to put [${table.join(".")}] next to`);
  const at = Math.max(...family.map(contentEnd));
  if (table[table.length - 1] === "env") {
    const env = table[0] === "proxy" ? next.proxy.env : next.groups[table[1]].env;
    return insertAt(lines, at, envBlock(table.join("."), env));
  }
  return insertAt(lines, at, [`[${table.join(".")}]`, line]);
}

/** Inserts a block at line `at`, separated by one blank line on each side. */
function insertAt(lines: string[], at: number, block: string[]): string {
  const out = [...lines.slice(0, at), "", ...block, "", ...lines.slice(at)];
  while (out.length > 1 && !out[out.length - 1].trim() && !out[out.length - 2].trim()) out.pop();
  return collapseBlanks(out).join("\n");
}

/** At most one blank line in a row, and none at the very start. */
function collapseBlanks(lines: string[]): string[] {
  const out = lines.filter((l, i) => l.trim() || (i > 0 && lines[i - 1].trim()));
  while (out.length && !out[0].trim()) out.shift();
  return out;
}

/** JSON with sorted keys: equal configs, equal strings. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}
