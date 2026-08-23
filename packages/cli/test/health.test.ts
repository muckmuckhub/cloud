import { describe, expect, test } from "bun:test";
import { healthVerdict, type ServiceStatus } from "../src/docker.ts";
import { rollingPlan } from "../src/plan.ts";
import { config } from "./helpers.ts";

function svc(over: Partial<ServiceStatus>): ServiceStatus {
  return { name: "lobby-1", state: "running", health: "-", uptime: "-", ...over };
}

describe("healthVerdict", () => {
  test("healthy is ready", () => {
    expect(healthVerdict(svc({ health: "healthy" }))).toBe("ready");
  });

  test("running but still starting is NOT ready", () => {
    // The whole point: a Paper container is "running" seconds after it is
    // created and cannot accept a login for another minute. Treating running
    // as ready takes the next instance down mid-boot.
    expect(healthVerdict(svc({ health: "starting" }))).toBe("waiting");
  });

  test("running with no health information is ready only provisionally", () => {
    // Observed live during a crash loop: restarting -> running (health empty)
    // -> running (starting) -> restarting. Accepting that empty window as
    // ready declared a dying server healthy, and the rollout went on to take
    // down the rest of the group. The caller waits for it to hold.
    expect(healthVerdict(svc({ health: "-" }))).toBe("ready-unverified");
    expect(healthVerdict(svc({ health: "" }))).toBe("ready-unverified");
  });

  test("only a real healthcheck gives an immediate ready", () => {
    expect(healthVerdict(svc({ health: "healthy" }))).toBe("ready");
    expect(healthVerdict(svc({ health: "-" }))).not.toBe("ready");
  });

  test("a container that exited is a failure, not a slow start", () => {
    expect(healthVerdict(svc({ state: "exited" }))).toBe("failed");
    expect(healthVerdict(svc({ state: "dead" }))).toBe("failed");
  });

  test("unhealthy is a failure even while running", () => {
    expect(healthVerdict(svc({ state: "running", health: "unhealthy" }))).toBe("failed");
  });

  test("a crash loop waits rather than failing on the first sample", () => {
    // Restarting can be a legitimate transient. The timeout catches the loop.
    expect(healthVerdict(svc({ state: "restarting" }))).toBe("waiting");
    expect(healthVerdict(svc({ state: "created" }))).toBe("waiting");
  });

  test("a service compose has not created yet is waiting, not failed", () => {
    expect(healthVerdict(undefined)).toBe("waiting");
  });
});

describe("rollingPlan", () => {
  test("cycles groups that run more than one instance", () => {
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true, min: 3 },
        smp: { version: "1.21.10", static: true },
      },
    });
    expect(rollingPlan(cfg)).toEqual([
      { group: "lobby", instances: ["lobby-1", "lobby-2", "lobby-3"] },
    ]);
  });

  test("skips single-instance groups — they have nothing to fail over to", () => {
    expect(rollingPlan(config())).toEqual([]);
  });

  test("covers every multi-instance group", () => {
    const cfg = config({
      groups: {
        lobby: { version: "1.21.10", fallback: true, min: 2 },
        minigames: { version: "1.21.10", min: 4 },
        smp: { version: "1.21.10", static: true },
      },
    });
    expect(rollingPlan(cfg).map((g) => g.group)).toEqual(["lobby", "minigames"]);
    expect(rollingPlan(cfg)[1].instances).toHaveLength(4);
  });

  test("instance order is stable, so a rollout is repeatable", () => {
    const cfg = config({
      groups: { lobby: { version: "1.21.10", fallback: true, min: 3 } },
    });
    expect(rollingPlan(cfg)).toEqual(rollingPlan(cfg));
  });

  test("every cycled instance is one the proxy can fail over to", () => {
    // A rollout is only survivable if the instances being taken down are
    // siblings in the fallback list. Same source, instanceNames, for both.
    const cfg = config({
      groups: { lobby: { version: "1.21.10", fallback: true, min: 3 } },
    });
    const cycled = rollingPlan(cfg)[0].instances;
    expect(cycled).toEqual(["lobby-1", "lobby-2", "lobby-3"]);
  });
});
