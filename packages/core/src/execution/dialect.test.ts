import { describe, expect, it } from "vitest";
import { Table } from "./table.js";
import { TableDefinition } from "../definition/table.js";
import { ColumnDefinition } from "../definition/column.js";
import { QueryDialect } from "./dialect.js";
import { sql } from "../sql/tag.js";

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

  it("should build a select query with where clause", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      where: sql`${table.columns.id} = ${sql.param(1)}`,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT * FROM "users" WHERE "users"."id" = $1');
    expect(builtQuery.params).toEqual([1]);
  });

  it("should build a select query with order by clause", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      order: [sql`${table.columns.name} ASC`],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT * FROM "users" ORDER BY "users"."name" ASC');
  });

  it("should build a select query with all clauses", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [table.columns.id, table.columns.name],
      where: sql`${table.columns.id} = ${sql.param(1)}`,
      order: [sql`${table.columns.name} ASC`],
      limit: 10,
      offset: 0,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `SELECT "users"."id", "users"."name" FROM "users" WHERE "users"."id" = $1 ORDER BY "users"."name" ASC LIMIT $2 OFFSET $3`
    );
    expect(builtQuery.params).toEqual([1, 10, 0]);
  });

  it("should build an insert query", () => {
    const query = dialect.buildInsertQuery({
      table,
      columns: [sql.identifier(table.columns.id.name), sql.identifier(table.columns.name.name)],
      values: [
        [sql.param(1), sql.param("Alice")],
        [sql.param(2), sql.param("Bob")],
      ],
      return: [table.columns.id],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `INSERT INTO "users" ("id", "name") VALUES ($1, $2), ($3, $4) RETURNING "users"."id"`
    );
    expect(builtQuery.params).toEqual([1, "Alice", 2, "Bob"]);
  });

  it("should build an update query", () => {
    const query = dialect.buildUpdateQuery({
      table,
      set: [[sql.identifier(table.columns.name.name), sql.param("Charlie")]],
      where: sql`${table.columns.id} = ${sql.param(1)}`,
      return: [table.columns.name],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `UPDATE "users" SET "name" = $1 WHERE "users"."id" = $2 RETURNING "users"."name"`
    );
    expect(builtQuery.params).toEqual(["Charlie", 1]);
  });

  it("should build a delete query", () => {
    const query = dialect.buildDeleteQuery({
      table,
      where: sql`${table.columns.id} = ${sql.param(1)}`,
      return: [table.columns.id],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `DELETE FROM "users" WHERE "users"."id" = $1 RETURNING "users"."id"`
    );
    expect(builtQuery.params).toEqual([1]);
  });
});
