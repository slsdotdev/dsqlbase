import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { InvalidCursorError, keysetSignature } from "../pagination/cursor.js";
import { UnionClient } from "./client.js";
import {
  datetime,
  guid,
  hasMany,
  relations,
  table,
  text,
  union,
  uuid,
} from "../../schema/index.js";
import { encodeGlobalId } from "../../schema/utils/global-id.js";

const photos = table("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  caption: text("caption"),
  photoUrl: text("photo_url").notNull(),
});

const videos = table("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  caption: text("caption"),
  videoUrl: text("video_url").notNull(),
});

const posts = union(
  { photos, videos },
  {
    id: uuid("id"),
    userId: uuid("user_id").notNull(),
    createdAt: datetime("created_at").notNull(),
    caption: text("caption"),
  }
);

const schema = { photos, videos, posts };

describe("UnionClient", () => {
  let calls: SQLStatement[];
  let results: unknown[][];
  let dsql: ReturnType<typeof createClient<typeof schema>>;

  beforeEach(() => {
    calls = [];
    results = [];

    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return results.shift() ?? [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
  });

  const text_ = (index = 0) => calls[index]?.text ?? "";

  it("is attached under the union's alias", () => {
    expect(dsql.posts).toBeInstanceOf(UnionClient);
    expect(Object.keys(dsql)).toContain("posts");
  });

  it("reads every member as one list", async () => {
    results = [
      [
        {
          data: {
            $$key: "photos",
            id: "p1",
            user_id: "u1",
            created_at: "2026-01-01T00:00:00Z",
            caption: null,
            photo_url: "a",
          },
        },
        {
          data: {
            $$key: "videos",
            id: "v1",
            user_id: "u1",
            created_at: "2026-01-02T00:00:00Z",
            caption: "c",
            video_url: "b",
          },
        },
      ],
    ];

    const rows = await dsql.posts.findMany({
      where: { userId: { eq: "u1" } },
      orderBy: { createdAt: "desc" },
    });

    expect(text_()).toMatch(/^SELECT row_to_json\("__j0"\.\*\) AS "data"/);
    expect(text_()).toContain(`WHERE "__t0"."user_id" = $1`);
    expect(text_()).toContain(`WHERE "__t1"."user_id" = $2`);
    expect(rows.map((row) => row.$$key)).toEqual(["photos", "videos"]);
    expect(rows[1]?.createdAt).toEqual(new Date("2026-01-02T00:00:00Z"));
  });

  it("requires findOne to name its row", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => dsql.posts.findOne({ where: {} } as any)).toThrow(
      /findOne on union "posts" needs a where/
    );
  });

  it("prunes members by $$key at the top level too", async () => {
    await dsql.posts.findMany({ where: { $$key: "videos" } });

    expect(text_()).not.toContain('"photos"');
  });

  it("counts across members", async () => {
    results = [[{ count: "5" }]];

    const count = await dsql.posts.count({ where: { caption: { exists: true } } });

    expect(text_()).toBe(
      'SELECT (SELECT count(*) FROM "photos" AS "__t0" WHERE "__t0"."caption" IS NOT NULL) + ' +
        '(SELECT count(*) FROM "videos" AS "__t0" WHERE "__t0"."caption" IS NOT NULL) AS "count"'
    );
    expect(count).toBe(5);
  });

  describe("paginate", () => {
    const row = (key: string, id: string, at: string) => ({
      data: {
        $$key: key,
        id,
        user_id: "u1",
        created_at: at,
        caption: null,
        photo_url: "a",
        video_url: "b",
      },
      __k0: at,
      __k1: key,
      __k2: id,
    });

    it("reads one row more than the page and signs cursors over the union's total order", async () => {
      results = [
        [
          row("photos", "p1", "2026-01-03T00:00:00Z"),
          row("videos", "v1", "2026-01-02T00:00:00Z"),
          row("photos", "p2", "2026-01-01T00:00:00Z"),
        ],
      ];

      const page = await dsql.posts.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });

      expect(calls[0]?.params.at(-1)).toBe(3);
      expect(page.items.map((item) => item.$$key)).toEqual(["photos", "videos"]);
      expect(page.hasNextPage).toBe(true);
      expect(page.hasPreviousPage).toBe(false);

      const signature = keysetSignature("posts", [
        { field: "createdAt", direction: "desc" },
        { field: "$$key", direction: "desc" },
        { field: "$$pk0", direction: "desc" },
      ]);
      const [taken] = JSON.parse(
        Buffer.from((page.endCursor ?? "").slice(3), "base64url").toString()
      ) as [string];

      expect(taken).toBe(signature);
    });

    it("continues after a cursor with the keyset in every branch", async () => {
      results = [
        [row("videos", "v1", "2026-01-02T00:00:00Z"), row("photos", "p2", "2026-01-01T00:00:00Z")],
      ];
      const first = await dsql.posts.paginate({ orderBy: { createdAt: "desc" }, limit: 1 });

      await dsql.posts.paginate({
        orderBy: { createdAt: "desc" },
        limit: 1,
        after: first.endCursor,
      });

      expect(text_(1)).toContain(
        `WHERE "__t0"."created_at" < $1 OR ("__t0"."created_at" = $2 AND ('photos' < $3`
      );
      expect(calls[1]?.params.slice(0, 5)).toEqual([
        "2026-01-02T00:00:00Z",
        "2026-01-02T00:00:00Z",
        "videos",
        "videos",
        "v1",
      ]);
    });

    it("refuses a cursor taken under another order", async () => {
      results = [
        [row("videos", "v1", "2026-01-02T00:00:00Z"), row("photos", "p2", "2026-01-01T00:00:00Z")],
      ];
      const first = await dsql.posts.paginate({ orderBy: { createdAt: "desc" }, limit: 1 });

      expect(() =>
        dsql.posts.paginate({ orderBy: { createdAt: "asc" }, after: first.endCursor })
      ).toThrow(InvalidCursorError);
    });

    it("counts the same members and filters, without the keyset", async () => {
      results = [[], [{ count: "0" }]];

      const page = await dsql.posts.paginate({ where: { $$key: "videos" }, count: true });

      expect(page.totalCount).toBe(0);
      expect(calls[1]?.text).toBe('SELECT (SELECT count(*) FROM "videos" AS "__t0") AS "count"');
    });
  });
});

describe("UnionClient — global ids on a shared field", () => {
  const authors = table("authors", { id: guid("id").primaryKey() });
  const photos = table("photos", {
    id: guid("id").primaryKey(),
    authorId: guid("author_id"),
    photoUrl: text("photo_url").notNull(),
  });
  const videos = table("videos", {
    id: guid("id").primaryKey(),
    authorId: guid("author_id"),
    videoUrl: text("video_url").notNull(),
  });
  const posts = union({ photos, videos }, { id: guid("id"), authorId: guid("author_id") });
  const authorRelations = relations(authors, {
    posts: hasMany(posts, { from: [authors.columns.id], to: [posts.columns.authorId] }),
  });
  const schema = { authors, photos, videos, posts, authorRelations };

  const PHOTO = "11111111-1111-4111-8111-111111111111";
  const VIDEO = "22222222-2222-4222-8222-222222222222";
  const AUTHOR = "33333333-3333-4333-8333-333333333333";
  const photoId = encodeGlobalId("photos", { id: PHOTO });
  const videoId = encodeGlobalId("videos", { id: VIDEO });
  const authorId = encodeGlobalId("authors", { id: AUTHOR });

  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<typeof schema>>;

  beforeEach(() => {
    calls = [];

    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
  });

  const query = () => calls[0];

  it("reads only the member an eq id names", async () => {
    await dsql.posts.findOne({ where: { id: { eq: photoId } } });

    expect(query()?.text).toContain('FROM "photos"');
    expect(query()?.text).not.toContain('FROM "videos"');
    expect(query()?.params).toContain(PHOTO);
  });

  it("splits an in list between the members its ids name", async () => {
    await dsql.posts.findMany({ where: { id: { in: [photoId, videoId] } } });

    expect(query()?.text).toContain('FROM "photos"');
    expect(query()?.text).toContain('FROM "videos"');
    expect(query()?.params).toEqual(expect.arrayContaining([PHOTO, VIDEO]));
  });

  it("reads a member a neq id cannot name as every row with a value", async () => {
    await dsql.posts.findMany({ where: { id: { neq: photoId } } });

    expect(query()?.text).toMatch(/FROM "photos" AS "__t\d+" WHERE "__t\d+"\."id" <> \$\d+/);
    expect(query()?.text).toMatch(/FROM "videos" AS "__t\d+" WHERE "__t\d+"\."id" IS NOT NULL/);
  });

  it("keeps every member for a raw uuid", async () => {
    await dsql.posts.findMany({ where: { id: { eq: PHOTO } } });

    expect(query()?.text).toContain('FROM "photos"');
    expect(query()?.text).toContain('FROM "videos"');
  });

  it("keeps every member for a field all of them key to one node", async () => {
    await dsql.posts.findMany({ where: { authorId: { eq: authorId } } });

    expect(query()?.text).toContain('FROM "photos"');
    expect(query()?.text).toContain('FROM "videos"');
    expect(query()?.params).toEqual([AUTHOR, AUTHOR]);
  });

  it("decides a condition inside or and not", async () => {
    await dsql.posts.findMany({
      where: { or: [{ id: { eq: photoId } }, { not: { id: { eq: videoId } } }] },
    });

    // photos: the first child may match, the second is true — no condition left.
    expect(query()?.text).toMatch(/FROM "photos" AS "__t\d+"\)/);
    // videos: the first child is false, the second stays.
    expect(query()?.text).toMatch(
      /FROM "videos" AS "__t\d+" WHERE \(NOT \("__t\d+"\."id" = \$1\)\)/
    );
  });
});
