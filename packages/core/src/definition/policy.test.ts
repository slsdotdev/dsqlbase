import { describe, expect, it } from "vitest";

import { TableDefinition } from "./table.js";
import { PolicyDefinition } from "./policy.js";
import { ColumnDefinition } from "./column.js";
import { sql } from "../sql/index.js";

const table = new TableDefinition("test_table", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").notNull().unique(),
  },
});

describe("PolicyDefinition", () => {
  it("should create a policy with the correct config", () => {
    const policy = new PolicyDefinition("test_policy", {
      table: table,
      as: "restrictive",
      using: (t) => sql`${t.id} IS NOT NULL`,
    });

    expect(policy.name).toBe("test_policy");
    expect(policy["_as"]).toBe("restrictive");
    expect(policy["_for"]).toBe("all");
    expect(policy["_table"]).toBe(table);
    expect(policy["_using"]).toBeDefined();
    expect(policy["_check"]).not.toBeDefined();
  });
});
