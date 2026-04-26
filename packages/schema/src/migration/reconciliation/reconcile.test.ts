import { describe, expect, it } from "vitest";
import { table, text, uuid } from "../../definition/index.js";
import { reconcileSchemas } from "./reconcile.js";
import { SerializedSchema } from "../base.js";

const usersTable = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  address: text("address"),
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
});
