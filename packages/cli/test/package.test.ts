import { describe, expect, test } from "bun:test";
import cli from "../package.json" with { type: "json" };
import schema from "../../schema/package.json" with { type: "json" };

describe("version", () => {
  // The CI tag check catches a mismatch with the tag, but only at release
  // time. Two packages drifting apart is visible on every PR.
  test("the CLI and the schema package are released together", () => {
    expect(cli.version).toBe(schema.version);
  });
});
