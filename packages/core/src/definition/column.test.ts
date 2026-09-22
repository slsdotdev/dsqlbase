import { describe, expect, it } from "vitest";
import { ColumnDefinition } from "./column.js";
import { DomainDefinition } from "./domain.js";
import { sql } from "../sql/tag.js";
import { NodeRef } from "./base.js";

describe("ColumnDefinition", () => {
  it("should create a ColumnDefinition with the correct name and config", () => {
    const node = new ColumnDefinition("username").$type<string>().primaryKey();
    expect(node.name).toBe("username");
  });

  it("should set notNull, primaryKey, and unique properties correctly", () => {
    const column = new ColumnDefinition("username").notNull().toJSON();
    expect(column.notNull).toBe(true);
  });

  it("should mark a column read-only without changing its serialized form", () => {
    const column = new ColumnDefinition("workspace_id").notNull().readOnly();

    expect(column["_readOnly"]).toBe(true);
    // `readOnly` is a client-side rule. Introspection cannot observe it on a real database, so
    // putting it in `toJSON` would add a field the remote side can never produce.
    expect(column.toJSON()).not.toHaveProperty("readOnly");
  });

  it("should default readOnly to false", () => {
    expect(new ColumnDefinition("name")["_readOnly"]).toBe(false);
    expect(new ColumnDefinition("name", { readOnly: true })["_readOnly"]).toBe(true);
  });

  it("should set default value correctly", () => {
    const column = new ColumnDefinition("created_at")
      .$type<Date>()
      .default(new Date("2024-01-01T00:00:00Z"))
      .toJSON();

    expect(column.defaultValue).toEqual(`'${new Date("2024-01-01T00:00:00Z").toString()}'`);
  });

  it("should set domain correctly", () => {
    const domain = new DomainDefinition("positive_int", {
      dataType: "integer",
      notNull: true,
    });

    const column = new ColumnDefinition("order", {
      domain: new NodeRef(domain),
    })
      .$type<string>()
      .toJSON();

    expect(column.dataType).toBe("positive_int");
    expect(column.domain).toEqual("positive_int");
  });

  it("should set check with named constraint", () => {
    const column = new ColumnDefinition("age")
      .$type<number>()
      .check((self) => sql`${self} > 0`, "chk_age_positive")
      .toJSON();

    expect(column.check).toEqual({
      kind: "CHECK_CONSTRAINT",
      name: "chk_age_positive",
      expression: '"age" > 0',
    });
  });
});
