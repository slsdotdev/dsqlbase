import { describe, expect, it } from "vitest";
import { Table } from "./table.js";
import { Column } from "./column.js";
import { sql } from "../sql/index.js";
import {
  ColumnDefinition,
  NamespaceDefinition,
  TableDefinition,
  NodeRef,
  TenantScopeDefinition,
} from "../definition/index.js";

describe("Table", () => {
  const definition = new TableDefinition("users", {
    columns: {
      id: new ColumnDefinition("id").primaryKey(),
      name: new ColumnDefinition("name").notNull(),
      email: new ColumnDefinition("email").notNull().unique(),
    },
  });

  it("should create a Table object with the correct name and columns", () => {
    const table = new Table(definition);

    expect(table.name).toBe("users");
    expect(table.schema).toBeUndefined();
  });

  it("should have columns with the correct names and configs", () => {
    const table = new Table(definition);

    expect(table.columns).toHaveProperty("id");
    expect(table.columns.id).toBeInstanceOf(Column);

    expect(table.columns).toHaveProperty("name");
    expect(table.columns.name).toBeInstanceOf(Column);

    expect(table.columns).toHaveProperty("email");
    expect(table.columns.email).toBeInstanceOf(Column);
  });

  it("should generate the correct SQL", () => {
    const table = new Table(definition);
    const { text } = sql`${table}`.toQuery();

    expect(text).toBe('"users"');
  });

  describe("primary key", () => {
    it("should expose a column-level primary key", () => {
      const table = new Table(definition);

      expect(table.primaryKey.map((col) => col.name)).toEqual(["id"]);
      expect(table.isCompositeKey).toBe(false);
    });

    it("should expose a table-level single-column primary key", () => {
      const def = new TableDefinition("posts", {
        columns: {
          slug: new ColumnDefinition("slug").notNull(),
          title: new ColumnDefinition("title"),
        },
      });
      def.primaryKey((c) => [c.slug]);

      const table = new Table(def);

      expect(table.primaryKey.map((col) => col.name)).toEqual(["slug"]);
      expect(table.isCompositeKey).toBe(false);
    });

    it("should expose a composite primary key in constraint order", () => {
      const def = new TableDefinition("team_members", {
        columns: {
          userId: new ColumnDefinition("user_id").notNull(),
          teamId: new ColumnDefinition("team_id").notNull(),
          role: new ColumnDefinition("role"),
        },
      });
      def.primaryKey((c) => [c.teamId, c.userId]);

      const table = new Table(def);

      expect(table.primaryKey.map((col) => col.name)).toEqual(["team_id", "user_id"]);
      expect(table.isCompositeKey).toBe(true);
    });

    it("should resolve key columns whose field alias differs from the column name", () => {
      const def = new TableDefinition("team_members", {
        columns: {
          teamId: new ColumnDefinition("team_id").notNull(),
          userId: new ColumnDefinition("user_id").notNull(),
        },
      });
      def.primaryKey((c) => [c.teamId, c.userId]);

      const table = new Table(def);

      expect(table.primaryKey.map((col) => col.name)).toEqual(["team_id", "user_id"]);
      expect(table.primaryKey[0]).toBe(table.columns.teamId);
      expect(table.primaryKey[1]).toBe(table.columns.userId);
    });

    it("should expose an empty primary key when the table declares none", () => {
      const def = new TableDefinition("logs", {
        columns: { message: new ColumnDefinition("message") },
      });

      const table = new Table(def);

      expect(table.primaryKey).toEqual([]);
      expect(table.isCompositeKey).toBe(false);
    });

    // A table has at most one PRIMARY KEY. Each source below prints independently in
    // packages/migration/src/ddl/printer.ts, so accepting them would emit DDL that
    // Postgres rejects with "multiple primary keys for table ... are not allowed".
    it("should throw when two columns are flagged as primary key", () => {
      const def = new TableDefinition("team_members", {
        columns: {
          teamId: new ColumnDefinition("team_id").primaryKey(),
          userId: new ColumnDefinition("user_id").primaryKey(),
        },
      });

      expect(() => new Table(def)).toThrow(
        /declares more than one primary key \(column "teamId", column "userId"\)/
      );
    });

    it("should throw when a flagged column is combined with a table-level constraint", () => {
      const def = new TableDefinition("team_members", {
        columns: {
          teamId: new ColumnDefinition("team_id").primaryKey(),
          userId: new ColumnDefinition("user_id").notNull(),
        },
      });
      def.primaryKey((c) => [c.teamId, c.userId]);

      expect(() => new Table(def)).toThrow(
        /declares more than one primary key \(column "teamId", constraint "team_members_primary_key"\)/
      );
    });

    it("should throw when two table-level primary keys are declared", () => {
      const def = new TableDefinition("team_members", {
        columns: {
          teamId: new ColumnDefinition("team_id").notNull(),
          userId: new ColumnDefinition("user_id").notNull(),
        },
      });
      def.primaryKey((c) => [c.teamId]);
      def.primaryKey((c) => [c.userId]);

      expect(() => new Table(def)).toThrow(/declares more than one primary key/);
    });
  });

  describe("unique keys", () => {
    it("lists the primary key first, then each unique column, sorted, without repeats", () => {
      const def = new TableDefinition("members", {
        columns: {
          id: new ColumnDefinition("id").primaryKey(),
          email: new ColumnDefinition("email").unique(),
          workspaceId: new ColumnDefinition("workspace_id").notNull(),
          handle: new ColumnDefinition("handle").notNull(),
        },
      });

      def.unique((c) => [c.workspaceId, c.handle]);
      def.unique((c) => [c.handle, c.workspaceId]);

      expect(new Table(def).uniqueKeys).toEqual([["id"], ["email"], ["handle", "workspaceId"]]);
    });

    it("is empty for a table with no key", () => {
      const def = new TableDefinition("logs", { columns: { at: new ColumnDefinition("at") } });

      expect(new Table(def).uniqueKeys).toEqual([]);
    });
  });

  describe("with schema", () => {
    const withSchema = new TableDefinition("users", {
      namespace: new NodeRef(new NamespaceDefinition("test")),
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
      },
    });

    it("should create a Table object with the correct schema", () => {
      const table = new Table(withSchema);

      expect(table.name).toBe("users");
      expect(table.schema).toBe("test");
    });

    it("should generate the correct SQL with schema", () => {
      const table = new Table(withSchema);
      const { text } = sql`${table}`.toQuery();

      expect(text).toBe('"test"."users"');
    });
  });
});

describe("Table meta", () => {
  const columns = { id: new ColumnDefinition("id").primaryKey() };

  it("reports the schema alias as `key` and the database name as `table`", () => {
    const table = new Table(new TableDefinition("team_members", { columns }), "members");

    expect(table.meta).toEqual({ key: "members", table: "team_members" });
  });

  it("falls back to the table name when built without an alias", () => {
    expect(new Table(new TableDefinition("users", { columns })).meta).toEqual({
      key: "users",
      table: "users",
    });
  });

  it("carries the namespace when the table declares one", () => {
    const billing = new NamespaceDefinition("billing");
    const definition = new TableDefinition("invoices", {
      columns,
      namespace: new NodeRef(billing),
    });

    expect(new Table(definition).meta).toEqual({
      key: "invoices",
      table: "invoices",
      schema: "billing",
    });
  });

  it("includes metadata declared with `table().meta()`", () => {
    const definition = new TableDefinition("users", { columns }).meta({ __typename: "User" });

    expect(new Table(definition).meta).toEqual({
      key: "users",
      table: "users",
      __typename: "User",
    });
  });

  it("is frozen, so a consumer cannot mutate what every row shares", () => {
    expect(Object.isFrozen(new Table(new TableDefinition("users", { columns })).meta)).toBe(true);
  });

  it("rejects declared metadata that would overwrite a built-in key", () => {
    const definition = new TableDefinition("users", { columns }).meta({ key: "impostor" });

    expect(() => new Table(definition)).toThrow(/meta key "key", which is built in/);
  });
});

describe("Table.tenantKeys", () => {
  const ws = new TenantScopeDefinition({
    workspaceId: new ColumnDefinition("workspace_id", { dataType: "uuid" }).notNull(),
    regionId: new ColumnDefinition("region_id", { dataType: "uuid" }).notNull(),
  });

  it("pairs each claim with the column it fills, in declaration order", () => {
    const table = new Table(
      ws.table("invoices", {
        id: new ColumnDefinition("id", { primaryKey: true }),
        number: new ColumnDefinition("number").notNull(),
      })
    );

    expect(table.tenantKeys.map(([claim]) => claim)).toEqual(["workspaceId", "regionId"]);
    expect(table.tenantKeys.map(([, column]) => column.name)).toEqual([
      "workspace_id",
      "region_id",
    ]);
    // The claim is the field name; the column carries the database name, which may differ.
    expect(table.tenantKeys[0]?.[1]).toBe(table.columns.workspaceId);
  });

  it("is empty for a table outside any scope", () => {
    const table = new Table(
      new TableDefinition("workspaces", {
        columns: { id: new ColumnDefinition("id", { primaryKey: true }) },
      })
    );

    expect(table.tenantKeys).toEqual([]);
  });
});
