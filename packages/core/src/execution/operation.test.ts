import { describe, expect, it } from "vitest";
import { QueryDialect } from "./dialect.js";
import { ExecutionContext } from "./context.js";
import { TableDefinition } from "../definition/table.js";
import { ColumnDefinition } from "../definition/column.js";
import { RelationsDefinition } from "../definition/relations.js";
import { RELATION_TYPE } from "../definition/index.js";
import { SchemaRegistry } from "./schema.js";
import { Session } from "../driver/session.js";
import { Schema } from "./types.js";

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
    authorId: new ColumnDefinition("authorId").notNull(),
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

const postRelations = new RelationsDefinition("posts", {
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

export const usersDislikedPosts = new RelationsDefinition("users", {
  table: users,
  relations: {
    dislikedPosts: {
      type: RELATION_TYPE.HAS_MANY,
      target: posts,
      from: [users["_columns"].id],
      to: [posts["_columns"].id],
    },
  },
});

const schema = {
  users,
  posts,
  usersRelations,
  postRelations,
  usersDislikedPosts,
};

export type ParsedSchema = Schema<typeof schema>;

const dialect = new QueryDialect();
const registry = new SchemaRegistry(schema);
const ctx = new ExecutionContext({ schema: registry, dialect, session: {} as Session });

describe("OperationFactory", () => {
  it("should create a SelectOperation with the correct query", () => {
    const { users } = registry.getTables();

    const { query } = ctx.operations.createSelect(users, {
      name: "selectUsers",
      mode: "many",
      args: {
        select: { id: true, name: true },
        where: { id: { eq: 1 } },
        orderBy: { name: "asc" },
        limit: 10,
        offset: 0,
        join: {
          dislikedPosts: true,
        },
      },
    });

    expect(query.text).toBe(
      `SELECT "users"."id", "users"."name" FROM "users" WHERE "users"."id" = $1 ORDER BY "users"."name" ASC LIMIT $2 OFFSET $3`
    );
    expect(query.params).toEqual([1, 10, 0]);
  });

  it("should create an InsertOperation with the correct name and args", () => {
    const { users } = registry.getTables();

    const { query } = ctx.operations.createInsert(users, {
      name: "insertUser",
      mode: "one",
      args: {
        data: { id: "1", name: "Alice", email: null },
        return: { id: true },
      },
    });

    expect(query.text).toBe(
      `INSERT INTO "users" ("id", "name", "email") VALUES ($1, $2, $3) RETURNING "users"."id"`
    );
    expect(query.params).toEqual(["1", "Alice", null]);
  });

  it("should create an UpdateOperation with the correct name and args", () => {
    const { users } = registry.getTables();
    const { query } = ctx.operations.createUpdate(users, {
      name: "updateUser",
      mode: "one",
      args: {
        set: { name: "Bob" },
        where: { id: { eq: 1 } },
        return: { name: true },
      },
    });

    expect(query.text).toBe(
      `UPDATE "users" SET "name" = $1 WHERE "users"."id" = $2 RETURNING "users"."name"`
    );
    expect(query.params).toEqual(["Bob", 1]);
  });

  it("should create a DeleteOperation with the correct name and args", () => {
    const { users } = registry.getTables();

    const { query } = ctx.operations.createDelete(users, {
      name: "deleteUser",
      mode: "one",
      args: {
        where: { id: { eq: 1 } },
        return: { id: true },
      },
    });

    expect(query.text).toBe(`DELETE FROM "users" WHERE "users"."id" = $1 RETURNING "users"."id"`);
    expect(query.params).toEqual([1]);
  });

  it("should create a SelectOperation with join", () => {
    const { users } = registry.getTables();

    const { query } = ctx.operations.createSelect(users, {
      name: "selectUsersWithPosts",
      mode: "one",
      args: {
        select: { id: true, name: true },
        where: { id: { eq: 1 } },
        join: {
          posts: {
            select: { title: true },
            where: { title: { like: "%test%" } },
          },
        },
      },
    });

    expect(query.text).toBe(
      `SELECT "users"."id", "users"."name", "__join_posts"."data" AS "posts" FROM "users" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__t".*)), '[]'::json) AS "data" FROM (SELECT "posts"."title" FROM "posts" WHERE "posts"."authorId" = "users"."id" AND "posts"."title" LIKE $1) AS "__t") AS "__join_posts" ON true WHERE "users"."id" = $2`
    );

    expect(query.params).toEqual(["%test%", 1]);
  });
});
