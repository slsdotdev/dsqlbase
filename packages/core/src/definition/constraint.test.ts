import { describe, expect, it } from "vitest";
import { ColumnDefinition } from "./column.js";
import { TableDefinition } from "./table.js";

describe("constraints", () => {
  const buildTable = () =>
    new TableDefinition("team_members", {
      columns: {
        teamId: new ColumnDefinition("team_id").notNull(),
        userId: new ColumnDefinition("user_id").notNull(),
        role: new ColumnDefinition("role"),
      },
    });

  describe("PrimaryKeyConstraintDefinition", () => {
    it("should serialize its key columns", () => {
      const table = buildTable();
      const constraint = table.primaryKey((c) => [c.teamId, c.userId]);

      expect(constraint.toJSON()).toEqual({
        kind: "PRIMARY_KEY_CONSTRAINT",
        name: "team_members_primary_key",
        columns: ["team_id", "user_id"],
        include: null,
      });
    });

    // Regression: include() used to assign _columns, replacing the key columns with the
    // included ones and always serializing include as null. The migration pipeline prints
    // both (packages/migration/src/ddl/printer.ts), so this emitted the wrong PRIMARY KEY.
    it("should add included columns without replacing the key columns", () => {
      const table = buildTable();
      const constraint = table.primaryKey((c) => [c.teamId, c.userId]).include((c) => [c.role]);

      expect(constraint.toJSON()).toEqual({
        kind: "PRIMARY_KEY_CONSTRAINT",
        name: "team_members_primary_key",
        columns: ["team_id", "user_id"],
        include: ["role"],
      });
    });
  });

  describe("UniqueConstraintDefinition", () => {
    it("should add included columns without replacing the constrained columns", () => {
      const table = buildTable();
      const constraint = table.unique((c) => [c.teamId, c.userId]).include((c) => [c.role]);

      expect(constraint.toJSON()).toEqual({
        kind: "UNIQUE_CONSTRAINT",
        name: "team_members_unique",
        columns: ["team_id", "user_id"],
        include: ["role"],
        distinctNulls: true,
      });
    });
  });
});
