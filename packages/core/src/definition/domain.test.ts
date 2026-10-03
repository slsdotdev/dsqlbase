import { describe, expect, it } from "vitest";
import { DomainDefinition } from "./domain.js";
import { sql } from "../sql/tag.js";
import { NamespaceDefinition } from "./namespace.js";

describe("DomainDefinition", () => {
  it("should create with defaults", () => {
    const domain = new DomainDefinition("status", {});
    const json = domain.toJSON();

    expect(json.kind).toBe("DOMAIN");
    expect(json.name).toBe("status");
    expect(json.dataType).toBe("text");
    expect(json.notNull).toBe(false);
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

    expect(json.defaultValue).toBe("'active'");
  });

  it("should set check constraint", () => {
    const json = new DomainDefinition("priority", { dataType: "integer" })
      .check((self) => sql`${self} >= 1 AND ${self} <= 5`)
      .toJSON();

    expect(json.check).toMatchObject({
      kind: "CHECK_CONSTRAINT",
      name: "priority_check",
      expression: "VALUE >= 1 AND VALUE <= 5",
    });
  });

  it("should set constraint name", () => {
    const json = new DomainDefinition("status", {})
      .check((id) => sql.in(id, ["active", "disabled"]), "chk_status")
      .toJSON();

    expect(json.check?.name).toBe("chk_status");
    expect(json.check?.expression).toBe("VALUE IN ('active', 'disabled')");
  });

  describe("column()", () => {
    it("keys the domain by its bare name, and types the column with it, in public", () => {
      const json = new DomainDefinition("status", {}).column("state").toJSON();

      expect(json.domain).toBe("status");
      expect(json.dataType).toBe("status");
    });

    // The planner orders a column after its domain by this key, and the column's type must not
    // depend on `search_path`.
    it("keys the domain as namespace.name, and qualifies the column's type, in a namespace", () => {
      const json = new NamespaceDefinition("app").domain("status").column("state").toJSON();

      expect(json.domain).toBe("app.status");
      expect(json.dataType).toBe(`"app"."status"`);
    });
  });
});
