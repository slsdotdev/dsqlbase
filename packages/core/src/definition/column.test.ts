import { describe, expect, it } from "vitest";
import { ColumnDefinition } from "./column.js";
import { DomainDefinition } from "./domain.js";
import { sql } from "../sql/tag.js";

describe("ColumnDefinition", () => {
  it("should create a ColumnDefinition with the correct name and config", () => {
    const node = new ColumnDefinition("username").$type<string>().primaryKey();
    expect(node.name).toBe("username");
  });

  it("should set notNull, primaryKey, and unique properties correctly", () => {
    const column = new ColumnDefinition("username").notNull().toJSON();
    expect(column.notNull).toBe(true);
  });

  it("should set default value correctly", () => {
    const column = new ColumnDefinition("created_at")
      .$type<Date>()
      .default(new Date("2024-01-01T00:00:00Z"))
      .toJSON();

    expect(column.defaultValue).toMatchObject({
      text: `'${new Date("2024-01-01T00:00:00Z").toString()}'`,
      params: [],
    });
  });

  it("should set check constraint correctly", () => {
    const column = new ColumnDefinition("age")
      .$type<number>()
      .check((self) => sql`${self} > 0`)
      .toJSON();

    expect(column.check).toEqual({
      kind: "SQL",
      text: '"age" > 0',
      params: [],
    });
  });

  it("should set domain correctly", () => {
    const domain = new DomainDefinition("positive_int", {
      dataType: "integer",
      notNull: true,
    });

    const column = new ColumnDefinition("order", {
      domain,
    })
      .$type<string>()
      .toJSON();

    expect(column.dataType).toBe("positive_int");
    expect(column.domain?.text).toEqual('"positive_int"');
  });

  it("should set constraint name", () => {
    const column = new ColumnDefinition("status").constraint("chk_status").toJSON();
    expect(column.constraint).toBe("chk_status");
  });

  it("should set check with named constraint", () => {
    const column = new ColumnDefinition("age")
      .$type<number>()
      .constraint("chk_age_positive")
      .check((self) => sql`${self} > 0`)
      .toJSON();

    expect(column.constraint).toBe("chk_age_positive");
    expect(column.check).toEqual({
      kind: "SQL",
      text: '"age" > 0',
      params: [],
    });
  });
});
