import { describe, expect, it } from "vitest";
import { Table } from "./table.js";
import { Column } from "./column.js";
import { sql } from "../sql/index.js";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  NamespaceDefinition,
  TableDefinition,
  NodeRef,
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

  describe("with relations", () => {
    const posts = new TableDefinition("posts", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
        userId: new ColumnDefinition("user_id").notNull(),
        authorId: new ColumnDefinition("author_id").notNull(),
      },
    });

    const users = new TableDefinition("users", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
      },
    });

    const userRelations = new RelationsDefinition(users, {
      posts: {
        target: posts,
        type: Relation.HAS_MANY,
        from: [users.columns.id],
        to: [posts.columns.userId],
      },
    });

    const secondUserRelations = new RelationsDefinition(users, {
      authored: {
        target: posts,
        type: Relation.HAS_MANY,
        from: [users.columns.id],
        to: [posts.columns.authorId],
      },
    });

    it("should create a Table object with the correct relations", () => {
      const table = new Table(definition, {
        ...userRelations.relations,
        ...secondUserRelations.relations,
      });

      expect(table.name).toBe("users");
      expect(table.relations).toHaveProperty("posts");
    });
  });
});
