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
});
