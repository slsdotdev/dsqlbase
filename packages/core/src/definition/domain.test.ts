import { describe, expect, it } from "vitest";
import { DomainDefinition } from "./domain.js";
import { sql } from "../sql/tag.js";

describe("DomainDefinition", () => {
  it("should create with defaults", () => {
    const domain = new DomainDefinition("status", {});
    const json = domain.toJSON();

    expect(json.kind).toBe("DOMAIN");
    expect(json.name).toBe("status");
    expect(json.dataType).toBe("text");
    expect(json.notNull).toBe(false);
    expect(json.constraint).toBeUndefined();
    expect(json.defaultValue).toBeUndefined();
    expect(json.check).toBeUndefined();
  });

  it("should serialize dataType", () => {
    const json = new DomainDefinition("positive_int", {
      dataType: "integer",
    }).toJSON();

    expect(json.dataType).toBe("integer");
  });

  it("should set notNull", () => {
    const json = new DomainDefinition("status", {}).notNull().toJSON();
    expect(json.notNull).toBe(true);
  });

  it("should set default value", () => {
    const json = new DomainDefinition("status", {}).default("active").toJSON();

    expect(json.defaultValue).toMatchObject({
      kind: "SQL",
      text: "'active'",
    });
  });

  it("should set check constraint", () => {
    const json = new DomainDefinition("priority", { dataType: "integer" })
      .check((self) => sql`${self} >= 1 AND ${self} <= 5`)
      .toJSON();

    expect(json.check).toMatchObject({
      kind: "SQL",
      text: '"priority" >= 1 AND "priority" <= 5',
    });
  });

  it("should set constraint name", () => {
    const json = new DomainDefinition("status", {})
      .constraint("chk_status")
      .toJSON();

    expect(json.constraint).toBe("chk_status");
  });
});
