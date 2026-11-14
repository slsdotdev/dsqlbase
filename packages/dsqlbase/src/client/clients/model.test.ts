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
              author: { posts: { comments: { id: true }, author: { feed: true } } },
            },
          },
        },
      });

      const calls = session.mock.mock.calls;
      expect(calls[0][0].text).toEqual(
        `SELECT "__t0"."id", "__t0"."name", "__join_posts"."data" AS "posts" FROM "users" AS "__t0" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__j0".*)), '[]'::json) AS "data" FROM (SELECT "__join_comments"."data" AS "comments" FROM "posts" AS "__t1" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__j1".*)), '[]'::json) AS "data" FROM (SELECT "__t2"."id", "__join_author"."data" AS "author" FROM "comments" AS "__t2" LEFT JOIN LATERAL (SELECT row_to_json("__j2".*) AS "data" FROM (SELECT "__join_posts"."data" AS "posts" FROM "users" AS "__t3" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__j3".*)), '[]'::json) AS "data" FROM (SELECT "__join_comments"."data" AS "comments", "__join_author"."data" AS "author" FROM "posts" AS "__t4" LEFT JOIN LATERAL (SELECT COALESCE(json_agg(row_to_json("__j4".*)), '[]'::json) AS "data" FROM (SELECT "__t5"."id" FROM "comments" AS "__t5" WHERE "__t5"."post_id" = "__t4"."id") AS "__j4") AS "__join_comments" ON true LEFT JOIN LATERAL (SELECT row_to_json("__j5".*) AS "data" FROM (SELECT "__join_feed"."data" AS "feed" FROM "users" AS "__t6" LEFT JOIN LATERAL (SELECT COALESCE(json_agg("__u0"."data"), '[]'::json) AS "data" FROM (SELECT row_to_json("__j6".*) AS "data" FROM (SELECT 'photos' AS "$$key", "__t7"."id", "__t7"."user_id", "__t7"."created_at", "__t7"."photo_url" FROM "photos" AS "__t7" WHERE "__t7"."user_id" = "__t6"."id") AS "__j6" UNION ALL SELECT row_to_json("__j7".*) AS "data" FROM (SELECT 'videos' AS "$$key", "__t8"."id", "__t8"."user_id", "__t8"."created_at", "__t8"."video_url" FROM "videos" AS "__t8" WHERE "__t8"."user_id" = "__t6"."id") AS "__j7") AS "__u0") AS "__join_feed" ON true WHERE "__t6"."id" = "__t4"."author_id" LIMIT $1) AS "__j5") AS "__join_author" ON true WHERE "__t4"."author_id" = "__t3"."id") AS "__j3") AS "__join_posts" ON true WHERE "__t3"."id" = "__t2"."author_id" LIMIT $2) AS "__j2") AS "__join_author" ON true WHERE "__t2"."post_id" = "__t1"."id") AS "__j1") AS "__join_comments" ON true WHERE "__t1"."author_id" = "__t0"."id") AS "__j0") AS "__join_posts" ON true WHERE "__t0"."id" = $3 LIMIT $4`
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
      // @ts-expect-error Testing invalid key scenario
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
