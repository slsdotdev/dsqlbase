import { describe, expect, it } from "vitest";
import { reconcileSchemas } from "./reconcile.js";
import { SerializedSchema } from "../base.js";
import { ColumnDefinition, DomainDefinition, TableDefinition } from "@dsqlbase/core";
import { createPrinter } from "../ddl/index.js";

const usersTable = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey().default("gen_random_uuid()"),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").notNull().unique(),
    address: new ColumnDefinition("address"),
  },
});

describe("Schema Reconciliation", () => {
  describe("when remote is missing object", () => {
    it("should generate a CREATE TABLE operation for the missing table", () => {
      const localSchema = [usersTable.toJSON()];
      const remoteSchema = [] as SerializedSchema;

      const result = reconcileSchemas(localSchema, remoteSchema);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("CREATE");
      expect(result.operations[0].statement).toMatchObject({
        __kind: "CREATE_TABLE",
        name: "users",
      });
    });
  });

  describe("when local is missing object", () => {
    it("should generate a DROP TABLE operation for the missing table", () => {
      const localSchema = [] as SerializedSchema;
      const remoteSchema = [usersTable.toJSON()];

      const result = reconcileSchemas(localSchema, remoteSchema);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("DROP");
      expect(result.operations[0].statement).toMatchObject({
        __kind: "DROP_TABLE",
        name: "users",
      });
    });
  });

  describe("when both schemas have the same object", () => {
    it("should not generate any operations", () => {
      const localSchema = [usersTable.toJSON()];
      const remoteSchema = [usersTable.toJSON()];

      const result = reconcileSchemas(localSchema, remoteSchema);
      expect(result.operations).toHaveLength(0);
    });
  });

  describe("when dropping a domain and the tables that use it", () => {
    const status = new DomainDefinition("status", { dataType: "text" });
    const tasks = new TableDefinition("tasks", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
        status: status.column("status"),
      },
    });
    const print = createPrinter();

    it("drops the tables before the domain", () => {
      const { operations } = reconcileSchemas([], [status.toJSON(), tasks.toJSON()]);

      expect(operations.map((op) => `${op.type} ${op.object.kind}`)).toEqual([
        "DROP TABLE",
        "DROP DOMAIN",
      ]);
    });

    // DSQL refuses `DROP DOMAIN … CASCADE`; a CASCADE elsewhere would drop what the plan
    // never listed.
    it("never cascades, with or without safeOperations", () => {
      for (const safeOperations of [true, false]) {
        const { operations } = reconcileSchemas([], [status.toJSON(), tasks.toJSON()], {
          safeOperations,
        });

        for (const op of operations) {
          expect(print(op.statement).text).toMatch(/ RESTRICT$/);
        }
      }
    });
  });
});
