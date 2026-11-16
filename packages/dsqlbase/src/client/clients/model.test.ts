import { beforeEach, describe, expect, it, vi } from "vitest";
import { context, session } from "../../../mocks/context.js";
import { ModelClient } from "./model.js";

describe("ModelClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    session.mock.mockResolvedValue([]);
  });

  describe("crud operations", () => {
    it("matches findOne query between versions", async () => {
      const table = context.schema.getTable("users");
      const users = new ModelClient(context, table);

      session.mock.mockResolvedValue([{ id: "123", name: "John Doe" }]);

      await users.findOne({
        where: { id: "123" },
        select: {
          id: true,
          name: true,
          posts: {
            comments: {
              id: true,
              author: {
                posts: {
                  comments: { id: true },
                  author: {
                    feed: { id: true },
                  },
                },
              },
            },
          },
        },
      });

      const calls = session.mock.mock.calls;

      expect(calls[0][0].text).toContain(
        `SELECT "__t0"."id", "__t0"."name", "__join_posts"."data" AS "posts" FROM "users"`
      );
      expect(calls[0][0].text).toContain(
        `SELECT "__join_comments"."data" AS "comments" FROM "posts"`
      );
      expect(calls[0][0].text).toContain(
        `SELECT "__t2"."id", "__join_author"."data" AS "author" FROM "comments" AS "__t2"`
      );
      expect(calls[0][0].text).toContain(
        `SELECT "__join_posts"."data" AS "posts" FROM "users" AS "__t3"`
      );
      expect(calls[0][0].text).toContain(
        `SELECT "__join_comments"."data" AS "comments", "__join_author"."data" AS "author" FROM "posts" AS "__t4"`
      );
      expect(calls[0][0].text).toContain(`SELECT "__t5"."id" FROM "comments" AS "__t5"`);
      expect(calls[0][0].text).toContain(
        `SELECT "__join_feed"."data" AS "feed" FROM "users" AS "__t6"`
      );
      expect(calls[0][0].text).toContain(
        `SELECT 'photos' AS "__type", "__t7"."id" FROM "photos" AS "__t7"`
      );
      expect(calls[0][0].text).toContain(
        `SELECT 'videos' AS "__type", "__t8"."id" FROM "videos" AS "__t8"`
      );
    });

    it("retrives a record by key", async () => {
      const table = context.schema.getTable("users");
      const users = new ModelClient(context, table);

      session.mock.mockResolvedValue([{ id: "123", name: "John Doe" }]);

      await users.get({ key: { id: "123" } });

      expect(session.mock).toHaveBeenCalledWith({
        text: 'SELECT "__t0"."id", "__t0"."name" FROM "users" AS "__t0" WHERE "__t0"."id" = $1 LIMIT $2',
        params: ["123", 1],
      });
    });

    it("throws when keys not provided or invalid", () => {
      const table = context.schema.getTable("users");
      const users = new ModelClient(context, table);

      expect(() => users.get({ key: {} })).toThrow(
        `Provided keys do not match any unique key for table "users".`
      );

      expect(() => users.get({ key: { name: "invalid" } })).toThrow(
        `Provided keys do not match any unique key for table "users". Expected one of: (id).`
      );
      expect(session.mock).not.toHaveBeenCalled();
    });
  });

  describe("ordering", () => {
    it("adds order by clause to the query", async () => {
      const table = context.schema.getTable("users");
      const users = new ModelClient(context, table);

      session.mock.mockResolvedValue([
        { id: "123", name: "John Doe" },
        { id: "124", name: "Jane Doe" },
      ]);

      await users.findMany({ orderBy: { name: "asc" } });

      expect(session.mock).toHaveBeenCalledWith({
        text: 'SELECT "__t0"."id", "__t0"."name" FROM "users" AS "__t0" ORDER BY "__t0"."name" ASC',
        params: [],
      });
    });

    it("adds nulls clause to the order by", async () => {
      const table = context.schema.getTable("posts");
      const posts = new ModelClient(context, table);

      session.mock.mockResolvedValue([
        { id: "123", title: "Post 1", description: null },
        { id: "124", title: "Post 2", description: "A description" },
      ]);

      await posts.findMany({
        select: { id: true },
        orderBy: { description: "asc" },
      });

      expect(session.mock).toHaveBeenCalledWith({
        text: 'SELECT "__t0"."id" FROM "posts" AS "__t0" ORDER BY "__t0"."description" ASC NULLS LAST',
        params: [],
      });
    });

    it("adds order clause to relations", async () => {
      const table = context.schema.getTable("users");
      const client = new ModelClient(context, table);

      await client.findOne({
        where: { id: { eq: "1" } },
        join: { feed: { where: { caption: { exists: true } }, orderBy: { caption: "asc" } } },
      });

      expect(session.mock.mock.calls[0][0].text).toContain(
        'SELECT COALESCE(json_agg("__u0"."data" ORDER BY "__o0" ASC NULLS LAST), \'[]\'::json)'
      );
    });
  });

  describe("pagination", () => {
    it("orders by declared keys then the primary key, projects them as text", async () => {
      const table = context.schema.getTable("posts");
      const posts = new ModelClient(context, table);

      await posts.paginatedQuery({
        select: { id: true, title: true },
        orderBy: { createdAt: "desc" },
        limit: 2,
      });

      expect(session.mock).toHaveBeenCalledWith({
        text:
          `SELECT "__t0"."id", "__t0"."title", ` +
          `"__t0"."created_at"::text AS "__k0", "__t0"."id"::text AS "__k1" ` +
          `FROM "posts" AS "__t0" ORDER BY "__t0"."created_at" DESC, "__t0"."id" DESC LIMIT $1`,
        params: [3],
      });
    });
  });
});
