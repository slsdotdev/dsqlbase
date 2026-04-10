import { describe, expect, it, vi } from "vitest";
import { ColumnDefinition } from "../definition/column.js";
import { TableDefinition } from "../definition/table.js";
import { Table } from "../execution/table.js";
import { ModelClient } from "./model.js";
import { ExecutionContext } from "../execution/context.js";

const tableDef = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").notNull().unique(),
    nickname: new ColumnDefinition("nickname"),
  },
});

const table = new Table(tableDef);
const context = vi.mockObject(ExecutionContext.prototype);

describe("ModelClient", () => {
  it("should create client instance", () => {
    const client = new ModelClient(context, table);
    expect(client).toBeInstanceOf(ModelClient);
  });
});
