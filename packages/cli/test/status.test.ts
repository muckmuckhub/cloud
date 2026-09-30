import { describe, expect, test } from "bun:test";
import { dockerEnv, parsePlayerList, uptimeFrom } from "../src/docker.ts";

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

describe("uptimeFrom", () => {
  test.each([
    ["Up 2 hours (healthy)", "2 hours"],
    ["Up About a minute (health: starting)", "About a minute"],
    ["Up 19 minutes", "19 minutes"],
    ["Up 3 days (unhealthy)", "3 days"],
  ])("%s -> %s", (status, want) => {
    expect(uptimeFrom(status)).toBe(want);
  });

  test("a container that is not up has no uptime", () => {
    expect(uptimeFrom("Exited (1) 3 minutes ago")).toBe("-");
    expect(uptimeFrom("Restarting (1) 5 seconds ago")).toBe("-");
    expect(uptimeFrom("")).toBe("-");
  });
});

describe("dockerEnv", () => {
  test("never passes the forwarding secret, so Compose reads the current one from .env", () => {
    // Bun loads .env into process.env at startup; a rotation then left the
    // old value in the shell environment, where it overrode the new .env.
    const env = dockerEnv({ PATH: "/bin", FORWARDING_SECRET: "stale", DOCKER_HOST: "x" });
    expect(env.FORWARDING_SECRET).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.DOCKER_HOST).toBe("x");
  });
});
