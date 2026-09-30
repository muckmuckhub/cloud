import { describe, expect, test } from "bun:test";
import { parsePlayerList } from "../src/docker.ts";

describe("parsePlayerList", () => {
  test("reads counts and names", () => {
    expect(
      parsePlayerList("There are 3 of a max of 20 players online: alice, bob, carol"),
    ).toEqual({ online: 3, max: 20, names: ["alice", "bob", "carol"] });
  });

  test("an empty server has no names, not one empty name", () => {
    expect(parsePlayerList("There are 0 of a max of 20 players online: ")).toEqual({
      online: 0,
      max: 20,
      names: [],
    });
  });

  test("tolerates the older wording without the second 'of'", () => {
    expect(parsePlayerList("There are 1 of a max 10 players online: alice")?.online).toBe(1);
  });

  test("strips section-sign and ANSI colour codes", () => {
    expect(
      parsePlayerList("§6There are §c2§6 of a max of §c50§6 players online: §falice, bob"),
    ).toEqual({ online: 2, max: 50, names: ["alice", "bob"] });
    expect(
      parsePlayerList("\x1b[33mThere are 1 of a max of 20 players online:\x1b[0m alice")
        ?.names,
    ).toEqual(["alice"]);
  });

  test("anything unrecognised is unknown, not zero", () => {
    expect(parsePlayerList("")).toBeNull();
    expect(parsePlayerList("Unknown command")).toBeNull();
    expect(parsePlayerList("Players: 3")).toBeNull();
  });
});
