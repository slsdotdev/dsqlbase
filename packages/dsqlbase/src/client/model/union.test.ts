import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import {
  date,
  datetime,
  guid,
  hasMany,
  hasOne,
  relations,
  table,
  text,
  union,
  uuid,
} from "../../schema/index.js";
import { encodeGlobalId } from "../../schema/utils/global-id.js";

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const photos = table("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  day: date("day"),
  createdAt: datetime("created_at").notNull(),
  photoUrl: text("photo_url").notNull(),
});

const videos = table("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("owner_id").notNull(),
  day: date("day"),
  createdAt: datetime("created_at").notNull(),
  videoUrl: text("video_url").notNull(),
});

const posts = union({ photos, videos });

const userRelations = relations(users, {
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
  latest: hasOne(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
});

const photoRelations = relations(photos, {
  owner: hasOne(users, { from: [photos.columns.userId], to: [users.columns.id] }),
});

const schema = { users, photos, videos, posts, userRelations, photoRelations };

describe("RequestNormalizer union joins", () => {
  let calls: SQLStatement[];
  let rows: unknown[];
  let dsql: ReturnType<typeof createClient<typeof schema>>;

  beforeEach(() => {
    calls = [];
    rows = [];

    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return rows;
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
  });

  const text_ = () => calls[0]?.text ?? "";
  const params = () => calls[0]?.params;
  const where = { id: { eq: "u1" } };

  it("runs every member with all of its columns when joined with true", async () => {
    await dsql.users.findOne({ where, join: { feed: true } });

    expect(text_()).toContain(`'photos' AS "$$key", "__t1"."id", "__t1"."user_id"`);
    expect(text_()).toContain(`'videos' AS "$$key", "__t2"."id", "__t2"."owner_id"`);
  });

  it("maps a shared select onto each member's own columns and merges on.<alias>.select", async () => {
    await dsql.users.findOne({
      where,
      join: {
        feed: {
          select: { id: true, userId: true },
          on: { photos: { select: { photoUrl: true } } },
        },
      },
    });

    expect(text_()).toContain(
      `'photos' AS "$$key", "__t1"."id", "__t1"."user_id", "__t1"."photo_url" FROM "photos"`
    );
    expect(text_()).toContain(`'videos' AS "$$key", "__t2"."id", "__t2"."owner_id" FROM "videos"`);
  });

  it("drops a member excluded with false", async () => {
    await dsql.users.findOne({ where, join: { feed: { on: { videos: false } } } });

    expect(text_()).not.toContain('"videos"');
    expect(text_()).not.toContain("UNION ALL");
  });

  it("emits no join when every member is excluded", async () => {
    rows = [{ id: "u1", name: "Ada" }];

    const user = await dsql.users.findOne({
      where,
      join: { feed: { on: { photos: false, videos: false } } },
    });

    expect(text_()).not.toContain("__join_feed");
    expect(user?.feed).toEqual([]);
  });

  it("applies the shared where inside every branch, encoded by each member's codec", async () => {
    await dsql.users.findOne({
      where,
      join: { feed: { where: { day: { eq: new Date("2026-05-01T00:00:00Z") } } } },
    });

    expect(text_()).toContain(`WHERE "__t1"."user_id" = "__t0"."id" AND ("__t1"."day" = $1)`);
    expect(text_()).toContain(`WHERE "__t2"."owner_id" = "__t0"."id" AND ("__t2"."day" = $2)`);
    expect(params()?.slice(0, 2)).toEqual(["2026-05-01", "2026-05-01"]);
  });

  it("ANDs on.<alias>.where with the shared where in that member only", async () => {
    await dsql.users.findOne({
      where,
      join: {
        feed: {
          where: { day: { exists: true } },
          on: { photos: { where: { photoUrl: { endsWith: ".png" } } } },
        },
      },
    });

    expect(text_()).toContain(`AND (("__t1"."day" IS NOT NULL) AND ("__t1"."photo_url" LIKE $1))`);
    expect(params()?.[0]).toBe("%.png");
    expect(text_()).toContain(`AND ("__t2"."day" IS NOT NULL)`);
  });

  it("orders, limits and offsets across members through the shared fields", async () => {
    await dsql.users.findOne({
      where,
      join: { feed: { orderBy: { createdAt: "desc" }, limit: 10, offset: 10 } },
    });

    expect(text_()).toContain('"__t1"."created_at" AS "__o0"');
    expect(text_()).toContain('ORDER BY "__o0" DESC, "$$key" ASC, "__pk0" ASC');
  });

  it("joins a member's own relations through on.<alias>.join", async () => {
    await dsql.users.findOne({
      where,
      join: { feed: { on: { photos: { join: { owner: true } } } } },
    });

    expect(text_()).toContain('AS "__join_owner" ON true');
  });

  it.each([
    [{ select: { photoUrl: true } }, /Invalid field "photoUrl" in selection for union "posts"/],
    [{ where: { photoUrl: "x" } }, /Invalid field "photoUrl" in where for union "posts"/],
    [{ where: { or: [{ videoUrl: "x" }] } }, /Invalid field "videoUrl" in where for union "posts"/],
    [{ orderBy: { photoUrl: "asc" } }, /Invalid field "photoUrl" in orderBy for union "posts"/],
    [{ on: { clips: true } }, /"clips" in `on` is not a member of union "posts"/],
    [{ distinct: true }, /`distinct` is not supported on union "posts"/],
  ])("rejects %j", (feed, error) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => dsql.users.findOne({ where, join: { feed: feed as any } })).toThrow(error);
  });

  it("resolves each row by its member and tags it with $$key", async () => {
    rows = [
      {
        id: "u1",
        name: "Ada",
        feed: [
          {
            $$key: "videos",
            id: "v1",
            owner_id: "u1",
            day: null,
            created_at: "2026-01-02T00:00:00.000Z",
            video_url: "b.mp4",
          },
        ],
        latest: null,
      },
    ];

    const user = await dsql.users.findOne({ where, join: { feed: true, latest: true } });
    const [post] = user?.feed ?? [];

    expect(post?.$$key).toBe("videos");
    expect(post?.$$meta.key).toBe("videos");
    expect(post?.createdAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(user?.latest).toBeNull();
  });

  describe("$$key in the shared where", () => {
    const feed = async (feedArgs: object) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await dsql.users.findOne({ where, join: { feed: feedArgs as any } });
      return text_();
    };

    it.each([
      ["eq", { $$key: { eq: "videos" } }],
      ["the bare-value shorthand", { $$key: "videos" }],
      ["neq", { $$key: { neq: "photos" } }],
      ["in", { $$key: { in: ["videos"] } }],
    ])("prunes the members %s rules out", async (_label, feedWhere) => {
      const text = await feed({ where: feedWhere });

      expect(text).not.toContain('"photos"');
      expect(text).toContain(`'videos' AS "$$key"`);
      expect(text).not.toContain("UNION ALL");
      // Decided while building, so nothing about $$key reaches SQL as a condition.
      expect(text).not.toMatch(/'videos' = |'videos' <>|IN \('videos'/);
    });

    it("drops a condition every member satisfies", async () => {
      const text = await feed({ where: { $$key: { in: ["photos", "videos"] } } });

      expect(text).toContain("UNION ALL");
      expect(text).toContain('WHERE "__t1"."user_id" = "__t0"."id") AS "__j0"');
    });

    it("keeps the rest of an or for the members $$key does not decide", async () => {
      const text = await feed({
        where: { or: [{ $$key: "videos" }, { day: { exists: true } }] },
      });

      // photos: the $$key branch is false, so only the other condition is left.
      expect(text).toContain(
        `WHERE "__t1"."user_id" = "__t0"."id" AND (("__t1"."day" IS NOT NULL))`
      );
      // videos: the $$key branch is true, so the whole or is.
      expect(text).toContain('WHERE "__t2"."owner_id" = "__t0"."id") AS "__j1"');
    });

    it("prunes a member whose and holds a false $$key", async () => {
      const text = await feed({
        where: { and: [{ $$key: { neq: "photos" } }, { day: { exists: true } }] },
      });

      expect(text).not.toContain('"photos"');
      expect(text).toContain(`AND (("__t1"."day" IS NOT NULL))`);
    });

    it("flips a $$key condition under not", async () => {
      const text = await feed({ where: { not: { $$key: "photos" } } });

      expect(text).not.toContain('"photos"');
      expect(text).toContain(`'videos' AS "$$key"`);
    });

    it("emits no join when $$key rules out every member", async () => {
      rows = [{ id: "u1", name: "Ada" }];

      const user = await dsql.users.findOne({
        where,
        join: { feed: { where: { $$key: { in: [] } } } },
      });

      expect(text_()).not.toContain("__join_feed");
      expect(user?.feed).toEqual([]);
    });

    it.each([
      [{ $$key: "clips" }, /names "clips", which is not a member/],
      [{ $$key: { in: ["photos", "clips"] } }, /names "clips", which is not a member/],
      [{ $$key: { gt: "photos" } }, /accepts eq, neq and in; got "gt"/],
    ])("rejects %j", (feedWhere, error) => {
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dsql.users.findOne({ where, join: { feed: { where: feedWhere } as any } })
      ).toThrow(error);
    });
  });

  it("orders by $$key across members", async () => {
    await dsql.users.findOne({ where, join: { feed: { orderBy: { $$key: "desc" } } } });

    expect(text_()).toContain('json_agg("__u0"."data" ORDER BY "$$key" DESC, "__pk0" ASC)');
  });
});

describe("global-id lookups with a widened on map", () => {
  const authors = table("authors", {
    id: guid("id").primaryKey(),
    name: text("name").notNull(),
  });
  const books = table("books", {
    id: guid("id").primaryKey(),
    authorId: guid("author_id", "authors").notNull(),
    title: text("title").notNull(),
  });
  const authorRelations = relations(authors, {
    books: hasMany(books, { from: [authors.columns.id], to: [books.columns.authorId] }),
  });
  const nodeSchema = { authors, books, authorRelations };

  it("ANDs on.<alias>.where with the key filter and forwards on.<alias>.join", async () => {
    const calls: SQLStatement[] = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    const dsql = createClient({ schema: nodeSchema, session });
    const id = encodeGlobalId("authors", { id: "7b3c3a52-3c0a-4a57-9d6b-3b8f1ffb1b0a" });

    await dsql.$findByGlobalId({
      id,
      on: { authors: { where: { name: { beginsWith: "A" } }, join: { books: true } } },
    });

    expect(calls[0]?.text).toContain(`WHERE ("__t0"."id" = $1 AND "__t0"."name" LIKE $2)`);
    expect(calls[0]?.text).toContain('AS "__join_books" ON true');
  });
});
