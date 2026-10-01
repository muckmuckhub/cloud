import { c } from "./ui.ts";

export type DiffLine = { op: " " | "-" | "+"; text: string };

/**
 * Line diff by longest common subsequence.
 *
 * This replaced a common-prefix/common-suffix trim, which shows everything
 * between the first and last change as removed and re-added. A preset that
 * adds one line to each of two groups then printed both groups in full, twice,
 * and the one line that mattered was lost in the middle. The inputs are a
 * cloud.toml or a generated file — a few hundred lines — so the quadratic
 * table is nothing.
 */
export function diffLines(prev: string, next: string): DiffLine[] {
  const a = prev.split("\n");
  const b = next.split("\n");
  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: " ", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "-", text: a[i++] });
    } else {
      out.push({ op: "+", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ op: "-", text: a[i++] });
  while (j < b.length) out.push({ op: "+", text: b[j++] });
  return out;
}

/**
 * The changed lines with `context` unchanged lines around each change, and a
 * dim `…` between hunks. Unchanged lines are dimmed so the change stands out.
 * `cap` bounds the printed lines for large generated files.
 */
export function formatDiff(
  prev: string,
  next: string,
  opts: { context?: number; cap?: number } = {},
): string {
  const context = opts.context ?? 1;
  const cap = opts.cap ?? Infinity;
  const lines = diffLines(prev, next);
  const keep = lines.map(() => false);
  lines.forEach((l, k) => {
    if (l.op === " ") return;
    for (let d = -context; d <= context; d++) {
      if (lines[k + d]) keep[k + d] = true;
    }
  });

  const out: string[] = [];
  let shown = 0;
  let gap = false;
  for (let k = 0; k < lines.length; k++) {
    if (!keep[k]) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out.push(c.dim("    …"));
    gap = false;
    if (shown === cap) {
      const rest = lines.slice(k).filter((l) => l.op !== " ").length;
      out.push(c.dim(`    … ${rest} more changed lines`));
      break;
    }
    const { op, text } = lines[k];
    out.push(
      op === "-" ? c.red(`  - ${text}`) : op === "+" ? c.green(`  + ${text}`) : c.dim(`    ${text}`),
    );
    shown++;
  }
  return out.join("\n");
}
