import { describe, expect, it } from "vitest";
import { domain } from "./domain.js";

describe("domain definition factory", () => {
  it("should create a domain and column factory", () => {
    const status = domain("status");

    const activeStatus = status.column("active_status").notNull().default("active");
    const json = activeStatus.toJSON();

    expect(json.name).toBe("active_status");
    expect(json.dataType).toBe("status");
    expect(json.notNull).toBe(true);
    expect(json.defaultValue).toBe("'active'");
    expect(json.domain).toEqual("status");
  });
});
