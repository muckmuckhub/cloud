import { describe, expect, test } from "bun:test";
import { diffLines, formatDiff } from "../src/diff.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("diffLines", () => {
  test("two separate insertions stay two insertions", () => {
    // The old prefix/suffix trim reported everything between them as changed.
    const prev = "[a]\nx = 1\n\n[b]\ny = 2";
    const next = "[a]\nx = 1\nh = 1\n\n[b]\ny = 2\nh = 1";
    const changed = diffLines(prev, next).filter((l) => l.op !== " ");
    expect(changed).toEqual([
      { op: "+", text: "h = 1" },
      { op: "+", text: "h = 1" },
    ]);
  });

  test("a changed line is one removal and one addition", () => {
    const changed = diffLines("a\nb\nc", "a\nB\nc").filter((l) => l.op !== " ");
    expect(changed).toEqual([
      { op: "-", text: "b" },
      { op: "+", text: "B" },
    ]);
  });

  test("identical input has no changes", () => {
    expect(diffLines("a\nb", "a\nb").every((l) => l.op === " ")).toBe(true);
  });
});

describe("formatDiff", () => {
  test("shows each change with one line of context and elides the rest", () => {
    const prev = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n");
    const next = ["1", "2", "X", "4", "5", "6", "7", "Y"].join("\n");
    expect(strip(formatDiff(prev, next)).split("\n")).toEqual([
      "    2",
      "  - 3",
      "  + X",
      "    4",
      "    …",
      "    7",
      "  - 8",
      "  + Y",
    ]);
  });

  test("caps long diffs and says how much is left", () => {
    const prev = Array.from({ length: 100 }, (_, i) => `a${i}`).join("\n");
    const next = Array.from({ length: 100 }, (_, i) => `b${i}`).join("\n");
    const out = strip(formatDiff(prev, next, { cap: 5 }));
    expect(out.split("\n")).toHaveLength(6);
    expect(out).toContain("195 more changed lines");
  });
});
