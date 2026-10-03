import { describe, expect, it } from "vitest";
import { identity } from "./identity.js";

describe("identity()", () => {
  it("defaults to ALWAYS with DSQL-valid sequence options", () => {
    expect(identity("n").toJSON().identity).toEqual({
      type: "ALWAYS",
      options: expect.objectContaining({ dataType: "bigint", cache: 1 }),
    });
  });

  it("keeps the type and sequence name it is given", () => {
    const json = identity("n", { type: "BY DEFAULT", sequenceName: "n_seq" }).toJSON();

    expect(json.identity?.type).toBe("BY DEFAULT");
    expect(json.identity?.sequenceName).toBe("n_seq");
  });

  it("applies the option methods", () => {
    const json = identity("n").cache(65536).startValue(10).toJSON();

    expect(json.identity?.options).toEqual(
      expect.objectContaining({ cache: 65536, startValue: 10 })
    );
  });
});
