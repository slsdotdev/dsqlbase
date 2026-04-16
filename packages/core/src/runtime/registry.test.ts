import { describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
} from "../definition/index.js";
import { SchemaRegistry } from "./registry.js";
import { Table } from "./table.js";

const users = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").unique(),
  },
});

const posts = new TableDefinition("posts", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    title: new ColumnDefinition("title").notNull(),
    content: new ColumnDefinition("content"),
    publishedAt: new ColumnDefinition("published_at"),
    authorId: new ColumnDefinition("author_id").notNull(),
  },
});

const usersRelations = new RelationsDefinition(users, {
  posts: {
    type: Relation.HAS_MANY,
    target: posts,
    from: [users.columns.id],
    to: [posts.columns.authorId],
  },
});

const postsRelations = new RelationsDefinition(posts, {
  author: {
    type: Relation.BELONGS_TO,
    target: users,
    from: [posts.columns.authorId],
    to: [users.columns.id],
  },
});

export const usersDislikedPosts = new RelationsDefinition(users, {
  dislikedPosts: {
    type: Relation.HAS_MANY,
    target: posts,
    from: [users.columns.id],
    to: [posts.columns.id],
  },
});

describe("SchemaRegistry", () => {
  it("should create a registry with the provided schema", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    expect(registry).toBeInstanceOf(SchemaRegistry);
  });

  it("should retrieve a table by name", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    const usersTable = registry.getTable("users");
    const postsTable = registry.getTable("posts");

    expect(usersTable).toBeInstanceOf(Table);
    expect(usersTable.name).toBe("users");

    expect(postsTable).toBeInstanceOf(Table);
    expect(postsTable.name).toBe("posts");
  });

  it("should check if a table exists", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    expect(registry.hasTable("users")).toBe(true);
    expect(registry.hasTable("posts")).toBe(true);
    expect(registry.hasTable("nonexistent")).toBe(false);
  });

  it("should retrieve all tables", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    const tables = registry.getTables();

    expect(tables).toHaveProperty("users");
    expect(tables).toHaveProperty("posts");
  });

  it("should check if relations exist for a table", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    expect(registry.hasRelations("users")).toBe(true);
    expect(registry.hasRelations("posts")).toBe(true);
    expect(registry.hasRelations("nonexistent")).toBe(false);
  });

  it("should retrieve relations for a table", () => {
    const registry = new SchemaRegistry({
      users,
      posts,
      usersRelations,
      postsRelations,
      usersDislikedPosts,
    });

    const usersTableRelations = registry.getRelations("users");
    const postsTableRelations = registry.getRelations("posts");

    expect(usersTableRelations).toHaveProperty("posts");
    expect(usersTableRelations).toHaveProperty("dislikedPosts");
    expect(postsTableRelations).toHaveProperty("author");
  });

  it("should retrieve relation target fields", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    const userPostsTarget = registry.getRelationTarget("users", "posts");
    const postAuthorTarget = registry.getRelationTarget("posts", "author");

    expect(userPostsTarget).toEqual(registry.getTable("posts"));
    expect(postAuthorTarget).toEqual(registry.getTable("users"));
  });
});
