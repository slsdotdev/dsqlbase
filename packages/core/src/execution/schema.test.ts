import { describe, expect, it } from "vitest";
import { TableDefinition } from "../definition/table.js";
import { ColumnDefinition } from "../definition/column.js";
import { RELATION_TYPE, RelationsDefinition } from "../definition/index.js";
import { SchemaRegistry } from "./schema.js";
import { Table } from "./table.js";

const users = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
  },
});

const posts = new TableDefinition("user_posts", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    authorId: new ColumnDefinition("author_id").notNull(),
  },
});

const usersRelations = new RelationsDefinition("users", {
  table: users,
  relations: {
    posts: {
      type: RELATION_TYPE.HAS_MANY,
      target: posts,
      from: [users["_columns"].id],
      to: [posts["_columns"].authorId],
    },
  },
});

const postRelations = new RelationsDefinition("user_posts", {
  table: posts,
  relations: {
    author: {
      type: RELATION_TYPE.BELONGS_TO,
      target: users,
      from: [posts["_columns"].authorId],
      to: [users["_columns"].id],
    },
  },
});

describe("SchemaRegistry", () => {
  it("should build tables from schema definition", () => {
    const registry = new SchemaRegistry({
      users,
      posts,
      usersRelations,
      postRelations,
    });

    expect(registry.hasTable("users")).toBe(true);
    expect(registry.getTable("users")).toBeInstanceOf(Table);

    // By declared table name
    expect(registry.hasTable("posts")).toBe(true);
    expect(registry.getTable("posts")).toBeInstanceOf(Table);

    // By defined table name
    expect(registry.hasTable("user_posts")).toBe(true);
    expect(registry.getTable("user_posts")).toBeInstanceOf(Table);
    expect(registry.getTable("user_posts")).toBe(registry.getTable("posts"));
  });

  it("should build relations from schema definition", () => {
    const registry = new SchemaRegistry({
      users,
      posts,
      usersRelations,
      postRelations,
    });

    expect(registry.hasRelations("users")).toBe(true);
    expect(registry.getRelations("users")).toHaveProperty("posts");

    expect(registry.hasRelations("posts")).toBe(true);
    expect(registry.getRelations("posts")).toHaveProperty("author");

    expect(registry.hasRelations("user_posts")).toBe(true);
    expect(registry.getRelations("user_posts")).toHaveProperty("author");
  });

  it("should resolve relation targets", () => {
    const registry = new SchemaRegistry({
      users,
      posts,
      usersRelations,
      postRelations,
    });

    expect(registry.getRelationTarget("users", "posts")).toBe(registry.getTable("user_posts"));
    expect(registry.getRelationTarget("posts", "author")).toBe(registry.getTable("users"));
    expect(registry.getRelationTarget("user_posts", "author")).toBe(registry.getTable("users"));
  });
});
