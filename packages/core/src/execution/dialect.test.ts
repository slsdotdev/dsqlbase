import { describe, expect, it } from "vitest";
import { Table } from "./table.js";
import { TableDefinition } from "../definition/table.js";
import { ColumnDefinition } from "../definition/column.js";
import { QueryDialect } from "./dialect.js";

const table = new Table(
  new TableDefinition("users", {
    columns: {
      id: new ColumnDefinition("id", { primaryKey: true }),
      name: new ColumnDefinition("name", { notNull: true }),
    },
  })
);

const dialect = new QueryDialect();

describe("Dialect", () => {
  it("should build a select query", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      limit: 10,
      offset: 0,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT * FROM "users" LIMIT $1 OFFSET $2');
    expect(builtQuery.params).toEqual([10, 0]);
  });

  it("should build a select query with distinct", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      distinct: true,
      limit: 10,
      offset: 0,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT DISTINCT * FROM "users" LIMIT $1 OFFSET $2');
    expect(builtQuery.params).toEqual([10, 0]);
  });

  it("should build a select query with selected fields", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [table.columns.id],
    });

    const { text } = query.toQuery();

    expect(text).toBe('SELECT "users"."id" FROM "users"');
  });
});
