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

  describe("with schema", () => {
    const withSchema = new TableDefinition("users", {
      schema: new NamespaceDefinition("test"),
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
