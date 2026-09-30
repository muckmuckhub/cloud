import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sym } from "./platform.ts";

const enabled =
  stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const wrap = (code: string) => (s: string) =>
  enabled ? `\x1b[${code}m${s}\x1b[0m` : s;

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  cyan: wrap("36"),
};

export function info(msg: string): void {
  console.log(msg);
}
export function warn(msg: string): void {
  console.error(`${c.yellow("warning")} ${msg}`);
}
export function fail(msg: string): never {
  console.error(`${c.red("error")} ${msg}`);
  process.exit(1);
}

export async function confirm(question: string, def = false): Promise<boolean> {
  if (!stdin.isTTY) return def;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const hint = def ? "Y/n" : "y/N";
    const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase();
    if (!answer) return def;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function ask(question: string, def?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const hint = def ? ` ${c.dim(`(${def})`)}` : "";
    const answer = (await rl.question(`${question}${hint} `)).trim();
    return answer || def || "";
  } finally {
    rl.close();
  }
}

export async function choose(
  question: string,
  options: string[],
  def = 0,
): Promise<string> {
  console.log(question);
  options.forEach((o, i) => {
    const marker = i === def ? c.cyan(sym.arrow) : " ";
    console.log(`  ${marker} ${i + 1}. ${o}`);
  });
  const raw = await ask(c.dim("choice"), String(def + 1));
  const idx = Number(raw) - 1;
  return options[Number.isInteger(idx) && options[idx] ? idx : def];
}

export { sym };

export function table(
  rows: Record<string, string>[],
  columns: string[],
): string {
  if (!rows.length) return c.dim("(nothing running)");
  // Measured without colour codes: `padEnd` counts escape bytes as width, so a
  // green "running" was padded as if it were nine characters longer.
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => visible(r[col] ?? ""))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell + " ".repeat(Math.max(0, widths[i] - visible(cell))))
      .join("  ");
  return [
    c.dim(line(columns.map((h) => h.toUpperCase()))),
    ...rows.map((r) => line(columns.map((col) => r[col] ?? ""))),
  ].join("\n");
}
