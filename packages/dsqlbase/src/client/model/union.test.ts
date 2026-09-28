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
