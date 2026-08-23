import { describe, expect, test } from "bun:test";
import { hasFlag, optionValue, positionals } from "../src/args.ts";

describe("optionValue", () => {
  test("reads the token after a flag", () => {
    expect(optionValue(["--context", "prod"], "--context")).toBe("prod");
  });

  test("is undefined when the flag is absent or has no value", () => {
    expect(optionValue(["lobby"], "--context")).toBeUndefined();
    expect(optionValue(["--context"], "--context")).toBeUndefined();
  });
});

describe("hasFlag", () => {
  test("matches any of the given spellings", () => {
    expect(hasFlag(["-y"], "-y", "--yes")).toBe(true);
    expect(hasFlag(["--yes"], "-y", "--yes")).toBe(true);
    expect(hasFlag(["--dry-run"], "-y", "--yes")).toBe(false);
  });
});

describe("positionals", () => {
  test("returns arguments that are not flags", () => {
    expect(positionals(["lobby"])).toEqual(["lobby"]);
    expect(positionals(["lobby", "-f"])).toEqual(["lobby"]);
    expect(positionals(["-f", "lobby"])).toEqual(["lobby"]);
  });

  test("does not mistake a flag's value for a positional", () => {
    // The bug this exists to prevent: `cloud logs --context prod lobby`
    // tailed a service called "prod".
    expect(positionals(["--context", "prod", "lobby"])).toEqual(["lobby"]);
    expect(positionals(["lobby", "--context", "prod"])).toEqual(["lobby"]);
  });

  test("handles --prompt, whose value is a whole sentence", () => {
    expect(positionals(["--prompt", "a lobby and a survival"])).toEqual([]);
  });

  test("keeps order and multiplicity, for `exec`", () => {
    expect(positionals(["lobby", "say", "hello"])).toEqual(["lobby", "say", "hello"]);
  });

  test("is empty when there is nothing but flags", () => {
    expect(positionals(["--dry-run", "-y"])).toEqual([]);
    expect(positionals([])).toEqual([]);
  });
});
