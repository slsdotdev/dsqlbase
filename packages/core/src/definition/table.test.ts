import { describe, expect, it } from "vitest";

import { TableDefinition } from "./table.js";
import { ColumnDefinition } from "./column.js";

describe("Table", () => {
  it("should create a TableBuilder with the correct name and columns", () => {
    const usersTable = new TableDefinition("users", {
      columns: {
        id: new ColumnDefinition("id", {}).primaryKey(),
        name: new ColumnDefinition("name", {}).notNull(),
      },
    });

    const node = usersTable.toJSON();

    expect(usersTable.name).toBe("users");
    expect(node.columns).toHaveProperty("id");
    expect(node.columns).toHaveProperty("name");
  });
});
