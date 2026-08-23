import { describe, expect, test } from "bun:test";
import { c, table } from "../src/ui.ts";

describe("colour", () => {
  test("is disabled when stdout is not a TTY, so logs stay pipeable", () => {
    // Tests run with stdout redirected, which is exactly the case that must
    // not emit escape codes.
    expect(c.red("x")).toBe("x");
  });
});

describe("table", () => {
  test("says so when there is nothing running", () => {
    expect(table([], ["service"])).toContain("nothing running");
  });

  test("pads columns to the widest cell, header included", () => {
    const out = table(
      [
        { service: "proxy", state: "running" },
        { service: "a-very-long-name", state: "exited" },
      ],
      ["service", "state"],
    );
    const [header, first, second] = out.split("\n");
    expect(header).toStartWith("SERVICE");
    expect(first.indexOf("running")).toBe(second.indexOf("exited"));
  });

  test("tolerates a missing column instead of printing undefined", () => {
    const out = table([{ service: "proxy" }], ["service", "health"]);
    expect(out).not.toContain("undefined");
  });
});
