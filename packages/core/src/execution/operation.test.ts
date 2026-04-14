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
    publishedAt: new ColumnDefinition("published_at"),
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
  describe("createSelect", () => {
    it("should create a `select one` operation with defaults", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUser",
        mode: "one",
        args: {
          select: {},
          where: { id: { eq: 1 } },
        },
      });

      expect(query.text).toBe(
        `SELECT "users"."id", "users"."name", "users"."email" FROM "users" WHERE "users"."id" = $1 LIMIT $2`
      );
      expect(query.params).toEqual([1, 1]);
    });

    it("should create a `select many` operation with defaults", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUsers",
        mode: "many",
        args: {
          select: {},
          where: { name: { like: "%test%" } },
        },
      });

      expect(query.text).toBe(
        `SELECT "users"."id", "users"."name", "users"."email" FROM "users" WHERE "users"."name" LIKE $1`
      );
      expect(query.params).toEqual(["%test%"]);
    });

    it("should apply the correct selection and where clauses", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUserNames",
        mode: "many",
        args: {
          select: { name: true },
          where: { email: { isNull: true } },
        },
      });

      expect(query.text).toBe(`SELECT "users"."name" FROM "users" WHERE "users"."email" IS NULL`);
      expect(query.params).toEqual([]);
    });

    it("should apply multiple where conditions with AND/OR/NOT", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUsersWithComplexWhere",
        mode: "many",
        args: {
          select: { id: true },
          where: {
            and: [
              { name: { like: "%test%" } },
              {
                or: [{ email: { isNull: true } }, { email: { like: "%example.com" } }],
              },
            ],
          },
        },
      });

      expect(query.text).toBe(
        `SELECT "users"."id" FROM "users" WHERE ("users"."name" LIKE $1 AND ("users"."email" IS NULL OR "users"."email" LIKE $2))`
      );
      expect(query.params).toEqual(["%test%", "%example.com"]);
    });

    it("should apply all select options in order", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUsersWithAllOptions",
        mode: "many",
        args: {
          select: { id: true, name: true },
          where: { email: { like: "%test%" } },
          orderBy: { name: "asc" },
          distinct: true,
          limit: 10,
          offset: 20,
        },
      });

      expect(query.text).toBe(
        `SELECT DISTINCT "users"."id", "users"."name" FROM "users" WHERE "users"."email" LIKE $1 ORDER BY "users"."name" ASC LIMIT $2 OFFSET $3`
      );
      expect(query.params).toEqual(["%test%", 10, 20]);
    });

    it("should create operations with joins", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUsersWithPosts",
        mode: "many",
        args: {
          select: { id: true, name: true },
          where: { id: { eq: 1 } },
          join: {
            posts: {
              select: { title: true, content: true },
              where: { title: { like: "%test%" } },
            },
          },
        },
      });

      expect(query.text).toBe(
        `SELECT "users"."id", "users"."name", "__join_posts"."data" AS "posts" FROM "users" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__t".*)), '[]'::json) AS "data" FROM (SELECT "posts"."title", "posts"."content" FROM "posts" WHERE "posts"."author_id" = "users"."id" AND "posts"."title" LIKE $1) AS "__t") AS "__join_posts" ON true WHERE "users"."id" = $2`
      );
      expect(query.params).toEqual(["%test%", 1]);
    });

    it("should create operation with one-to-one relation join", () => {
      const { posts } = registry.getTables();

      const { query } = ctx.operations.createSelect(posts, {
        name: "selectPostsWithAuthor",
        mode: "many",
        args: {
          select: { id: true, title: true },
          where: { id: { eq: 1 } },
          join: {
            author: {
              select: { name: true, email: true },
            },
          },
        },
      });

      expect(query.text).toBe(
        `SELECT "posts"."id", "posts"."title", "__join_author"."data" AS "author" FROM "posts" LEFT JOIN LATERAL (SELECT row_to_json("__t".*) AS "data" FROM (SELECT "users"."name", "users"."email" FROM "users" WHERE "users"."id" = "posts"."author_id" LIMIT $1) AS "__t") AS "__join_author" ON true WHERE "posts"."id" = $2`
      );
      expect(query.params).toEqual([1, 1]);
    });

    it("should create operation with join on a relation that has a custom name", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUsersWithDislikedPosts",
        mode: "many",
        args: {
          select: { id: true, name: true },
          where: { id: { eq: 1 } },
          join: {
            dislikedPosts: {
              select: { title: true },
            },
          },
        },
      });

      expect(query.text).toBe(
        `SELECT "users"."id", "users"."name", "__join_dislikedPosts"."data" AS "dislikedPosts" FROM "users" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__t".*)), '[]'::json) AS "data" FROM (SELECT "posts"."title" FROM "posts" WHERE "posts"."id" = "users"."id") AS "__t") AS "__join_dislikedPosts" ON true WHERE "users"."id" = $1`
      );
      expect(query.params).toEqual([1]);
    });

    it("should create operation with nested joins", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createSelect(users, {
        name: "selectUsersWithPostsAndAuthors",
        mode: "many",
        args: {
          select: { id: true, name: true },
          where: { id: { eq: 1 } },
          join: {
            posts: {
              select: { title: true },
              where: { title: { like: "%test%" } },
              join: {
                author: {
                  select: { name: true },
                },
              },
            },
          },
        },
      });

      expect(query.text).toBe(
        `SELECT "users"."id", "users"."name", "__join_posts"."data" AS "posts" FROM "users" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__t".*)), '[]'::json) AS "data" FROM (SELECT "posts"."title", "__join_author"."data" AS "author" FROM "posts" LEFT JOIN LATERAL (SELECT row_to_json("__t2".*) AS "data" FROM (SELECT "users"."name" FROM "users" WHERE "users"."id" = "posts"."author_id" LIMIT $1) AS "__t2") AS "__join_author" ON true WHERE "posts"."author_id" = "users"."id" AND "posts"."title" LIKE $2) AS "__t") AS "__join_posts" ON true WHERE "users"."id" = $3`
      );
      expect(query.params).toEqual([1, "%test%", 1]);
    });

    it("should resolve select respose for `one` select operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createSelect(users, {
        name: "selectUser",
        mode: "one",
        args: {
          select: { id: true, name: true },
          where: { id: { eq: 1 } },
        },
      });
      const result = operation.resolve([{ id: 1, name: "Alice" }]);

      expect(result).toEqual({ id: 1, name: "Alice" });
    });

    it("should resolve select response for `many` select operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createSelect(users, {
        name: "selectUsers",
        mode: "many",
        args: {
          select: { id: true, name: true },
          where: { id: { eq: 1 } },
          join: {
            posts: {
              select: { title: true, publishedAt: true },
              where: { not: { publishedAt: { isNull: true } } },
            },
          },
        },
      });

      const results = [
        {
          id: 1,
          name: "Alice",
          posts: [
            { title: "First Post", published_at: "2023-01-01T00:00:00.000Z" },
            { title: "Second Post", published_at: "2023-02-01T00:00:00.000Z" },
          ],
        },
      ];

      const result = operation.resolve(results);

      expect(result).toEqual([
        {
          id: 1,
          name: "Alice",
          posts: [
            { title: "First Post", publishedAt: "2023-01-01T00:00:00.000Z" },
            { title: "Second Post", publishedAt: "2023-02-01T00:00:00.000Z" },
          ],
        },
      ]);
    });
  });

  describe("createInsert", () => {
    it("should create an insert operation with the correct name and args", () => {
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

    it("should create an insert operation with multiple records", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createInsert(users, {
        name: "insertUsers",
        mode: "many",
        args: {
          data: [
            { id: "1", name: "Alice", email: null },
            { id: "2", name: "Bob", email: "" },
          ],
          return: { id: true },
        },
      });

      expect(query.text).toBe(
        `INSERT INTO "users" ("id", "name", "email") VALUES ($1, $2, $3), ($4, $5, $6) RETURNING "users"."id"`
      );
      expect(query.params).toEqual(["1", "Alice", null, "2", "Bob", ""]);
    });

    it("should resolve insert response for `one` insert operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createInsert(users, {
        name: "insertUser",
        mode: "one",
        args: {
          data: { id: "1", name: "Alice", email: null },
          return: { id: true },
        },
      });

      const result = operation.resolve([{ id: "1" }]);

      expect(result).toEqual({ id: "1" });
    });

    it("should resolve insert response for `many` insert operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createInsert(users, {
        name: "insertUsers",
        mode: "many",
        args: {
          data: [
            { id: "1", name: "Alice", email: null },
            { id: "2", name: "Bob", email: "" },
          ],
          return: { id: true },
        },
      });

      const result = operation.resolve([{ id: "1" }, { id: "2" }]);

      expect(result).toEqual([{ id: "1" }, { id: "2" }]);
    });
  });

  describe("createUpdate", () => {
    it("should create an update operation with the correct name and args", () => {
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

    it("should create an update operation with multiple set values", () => {
      const { users } = registry.getTables();

      const { query } = ctx.operations.createUpdate(users, {
        name: "updateUserEmail",
        mode: "one",
        args: {
          set: { name: "Bob", email: "", id: undefined },
          where: { id: { eq: 1 } },
          return: { name: true, email: true },
        },
      });

      expect(query.text).toBe(
        `UPDATE "users" SET "name" = $1, "email" = $2, "id" = $3 WHERE "users"."id" = $4 RETURNING "users"."name", "users"."email"`
      );
      expect(query.params).toEqual(["Bob", "", undefined, 1]);
    });

    it("should resolve update response for `one` update operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createUpdate(users, {
        name: "updateUser",
        mode: "one",
        args: {
          set: { name: "Bob" },
          where: { id: { eq: 1 } },
          return: { name: true },
        },
      });

      const result = operation.resolve([{ name: "Bob" }]);

      expect(result).toEqual({ name: "Bob" });
    });

    it("should resolve update response for `many` update operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createUpdate(users, {
        name: "updateUsers",
        mode: "many",
        args: {
          set: { name: "Bob" },
          where: { id: { in: [1, 2] } },
          return: { name: true },
        },
      });

      const result = operation.resolve([{ name: "Bob" }, { name: "Bob" }]);

      expect(result).toEqual([{ name: "Bob" }, { name: "Bob" }]);
    });
  });

  describe("createDelete", () => {
    it("should create a delete operation with the correct name and args", () => {
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

    it("should resolve delete response for `one` delete operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createDelete(users, {
        name: "deleteUser",
        mode: "one",
        args: {
          where: { id: { eq: 1 } },
          return: { id: true },
        },
      });

      const result = operation.resolve([{ id: 1 }]);

      expect(result).toEqual({ id: 1 });
    });

    it("should resolve delete response for `many` delete operation", () => {
      const { users } = registry.getTables();

      const operation = ctx.operations.createDelete(users, {
        name: "deleteUsers",
        mode: "many",
        args: {
          where: { id: { in: [1, 2] } },
          return: { id: true },
        },
      });

      const result = operation.resolve([{ id: 1 }, { id: 2 }]);

      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });
});
