import { describe, expect, it } from "vitest";
import { QueryDialect } from "./dialect.js";
import { OperationFactory } from "./operation.js";
import { ExecutionContext, ExecutionContextOptions } from "./context.js";
import { TableDefinition } from "../definition/table.js";
import { ColumnDefinition } from "../definition/column.js";
import { Table } from "./table.js";

const dialect = new QueryDialect();
const factory = new OperationFactory(new ExecutionContext({ dialect } as ExecutionContextOptions));

const tableDefinition = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email"),
  },
});

const table = new Table(tableDefinition);

describe("OperationFactory", () => {
  it("should create a SelectOperation with the correct query", () => {
    const { query } = factory.createSelect(table, {
      name: "selectUsers",
      args: {
        select: { id: true, name: true },
        where: { id: { eq: 1 } },
        orderBy: { name: "asc" },
        limit: 10,
        offset: 0,
      },
    });

    expect(query.text).toBe(
      `SELECT "users"."id", "users"."name" FROM "users" WHERE "users"."id" = $1 ORDER BY "users"."name" ASC LIMIT $2 OFFSET $3`
    );
    expect(query.params).toEqual([1, 10, 0]);
  });

  it("should create an InsertOperation with the correct name and args", () => {
    const { query } = factory.createInsert(table, {
      name: "insertUser",
      args: {
        data: { id: "1", name: "Alice", email: null },
        return: { id: true },
      },
    });

    expect(query.text).toBe(
      `INSERT INTO "users" ("id", "name", "email") VALUES ($1, $2, $3) RETURNING "users"."id"`
    );
    expect(query.params).toEqual(["1", "Alice", null]);
  });

  it("should create an UpdateOperation with the correct name and args", () => {
    const { query } = factory.createUpdate(table, {
      name: "updateUser",
      args: {
        set: { name: "Bob" },
        where: { id: { eq: 1 } },
        return: { name: true },
      },
    });

    expect(query.text).toBe(
      `UPDATE "users" SET "name" = $1 WHERE "users"."id" = $2 RETURNING "users"."name"`
    );
    expect(query.params).toEqual(["Bob", 1]);
  });

  it("should create a DeleteOperation with the correct name and args", () => {
    const { query } = factory.createDelete(table, {
      name: "deleteUser",
      args: {
        where: { id: { eq: 1 } },
        return: { id: true },
      },
    });

    expect(query.text).toBe(`DELETE FROM "users" WHERE "users"."id" = $1 RETURNING "users"."id"`);
    expect(query.params).toEqual([1]);
  });
});
