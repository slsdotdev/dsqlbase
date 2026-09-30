import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import {
  belongsTo,
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

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const posts = table("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").notNull(),
  title: text("title").notNull(),
});

const comments = table("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id").notNull(),
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
});

const photos = table("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  photoUrl: text("photo_url").notNull(),
});

const videos = table("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("owner_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  videoUrl: text("video_url").notNull(),
});

const media = union({ photos, videos });

const userRelations = relations(users, {
  posts: hasMany(posts, { from: [users.columns.id], to: [posts.columns.authorId] }),
  feed: hasMany(media, { from: [users.columns.id], to: [media.columns.userId] }),
});

const postRelations = relations(posts, {
  author: belongsTo(users, { from: [posts.columns.authorId], to: [users.columns.id] }),
  comments: hasMany(comments, { from: [posts.columns.id], to: [comments.columns.postId] }),
});

const commentRelations = relations(comments, {
  author: belongsTo(users, { from: [comments.columns.authorId], to: [users.columns.id] }),
});

const photoRelations = relations(photos, {
  owner: belongsTo(users, { from: [photos.columns.userId], to: [users.columns.id] }),
});

const schema = {
  users,
  posts,
  comments,
  photos,
  videos,
  media,
  userRelations,
  postRelations,
  commentRelations,
  photoRelations,
};

describe("relation fields in select", () => {
  let calls: SQLStatement[];
  let rows: Record<string, unknown>[];
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

  // Runs both forms and returns the statement each produced.
  const both = async (select: () => PromiseLike<unknown>, join: () => PromiseLike<unknown>) => {
    await select();
    await join();

    return [calls[0], calls[1]];
  };

  it("reads `true` as `join: { r: true }`", async () => {
    const [select, join] = await both(
      () => dsql.posts.findMany({ select: { id: true, author: true } }),
      () => dsql.posts.findMany({ select: { id: true }, join: { author: true } })
    );

    expect(select?.text).toBe(join?.text);
    expect(select?.text).toContain('AS "author"');
  });

  it("reads a field map as `join: { r: { select: map } }`", async () => {
    const [select, join] = await both(
      () => dsql.posts.findMany({ select: { id: true, author: { name: true } } }),
      () =>
        dsql.posts.findMany({ select: { id: true }, join: { author: { select: { name: true } } } })
    );

    expect(select?.text).toBe(join?.text);
  });

  it("nests: a relation inside a relation's field map", async () => {
    const [select, join] = await both(
      () =>
        dsql.posts.findMany({
          select: { title: true, comments: { body: true, author: { name: true } } },
        }),
      () =>
        dsql.posts.findMany({
          select: { title: true },
          join: {
            comments: { select: { body: true }, join: { author: { select: { name: true } } } },
          },
        })
    );

    expect(select?.text).toBe(join?.text);
  });

  it("keeps join's query args alongside a relation in select", async () => {
    const [select, join] = await both(
      () =>
        dsql.users.findMany({
          select: { name: true, posts: { title: true } },
          join: { feed: { orderBy: { createdAt: "desc" }, limit: 5 } },
        }),
      () =>
        dsql.users.findMany({
          select: { name: true },
          join: {
            posts: { select: { title: true } },
            feed: { orderBy: { createdAt: "desc" }, limit: 5 },
          },
        })
    );

    expect(select?.text).toBe(join?.text);
    expect(select?.params).toEqual(join?.params);
  });

  it("returns only the relations when no column is named", async () => {
    rows = [{ author: { id: "u1", name: "Ada" } }];

    const result = await dsql.posts.findMany({ select: { author: { name: true } } });

    expect(calls[0]?.text).toMatch(/^SELECT "__join_author"\."data" AS "author" FROM "posts"/);
    expect(result).toEqual([
      {
        $$meta: { key: "posts", table: "posts" },
        author: { $$meta: { key: "users", table: "users" }, name: "Ada" },
      },
    ]);
  });

  it("selects every column when select names nothing, as with no select", async () => {
    await dsql.posts.findMany({});
    await dsql.posts.findMany({ select: {} });
    await dsql.posts.findMany({ select: { id: false, author: false } });

    expect(calls[1]?.text).toBe(calls[0]?.text);
    expect(calls[2]?.text).toBe(calls[0]?.text);
    expect(calls[0]?.text).toContain('"__t0"."title"');
  });

  it("ignores a relation set to false in join when it is selected", async () => {
    const [select, join] = await both(
      () => dsql.posts.findMany({ select: { id: true, author: true }, join: { author: false } }),
      () => dsql.posts.findMany({ select: { id: true }, join: { author: true } })
    );

    expect(select?.text).toBe(join?.text);
  });

  it("refuses the same relation in select and join before any SQL runs", () => {
    expect(() =>
      dsql.posts.findMany({
        select: { author: true },
        // @ts-expect-error `author` is already in select
        join: { author: { select: { name: true } } },
      })
    ).toThrow('Relation "author" appears in both select and join on "posts"');
    expect(calls).toHaveLength(0);
  });

  it("refuses query args in a relation's field map: they belong in join", () => {
    expect(() =>
      dsql.users.findMany({
        // @ts-expect-error `where` is not a field of posts
        select: { posts: { where: { title: "x" } } },
      })
    ).toThrow('Invalid field "where" in selection for table "posts"');
  });

  it("refuses a field that is neither a column nor a relation", () => {
    expect(() =>
      dsql.posts.findMany({
        // @ts-expect-error `editor` is not a field of posts
        select: { editor: true },
      })
    ).toThrow('Invalid field "editor" in selection for table "posts"');
  });

  describe("a relation to a union", () => {
    it("takes the union's shared fields", async () => {
      const [select, join] = await both(
        () => dsql.users.findMany({ select: { name: true, feed: { id: true, createdAt: true } } }),
        () =>
          dsql.users.findMany({
            select: { name: true },
            join: { feed: { select: { id: true, createdAt: true } } },
          })
      );

      expect(select?.text).toBe(join?.text);
    });

    it("refuses a field one member only has", () => {
      expect(() =>
        dsql.users.findMany({
          // @ts-expect-error `photoUrl` is not shared by every member
          select: { feed: { photoUrl: true } },
        })
      ).toThrow(/only fields every member shares/);
    });
  });

  describe("a member's select under on", () => {
    it("reads a relation in on.<alias>.select as a member join", async () => {
      const [select, join] = await both(
        () => dsql.media.findMany({ on: { photos: { select: { id: true, owner: true } } } }),
        () =>
          dsql.media.findMany({
            on: { photos: { select: { id: true }, join: { owner: true } } },
          })
      );

      expect(select?.text).toBe(join?.text);
    });

    it("keeps the shared fields when a member's own select names only relations", async () => {
      await dsql.media.findMany({
        select: { id: true },
        on: { photos: { select: { owner: { name: true } } } },
      });

      const text = calls[0]?.text ?? "";

      expect(text).toContain('"photos"');
      expect(text).not.toContain('"photo_url"');
      expect(text).toContain('AS "owner"');
    });

    it("refuses a relation in both a member's select and join", () => {
      expect(() =>
        dsql.media.findMany({
          on: { photos: { select: { owner: true }, join: { owner: true } } },
        })
      ).toThrow('Relation "owner" appears in both select and join on "photos"');
    });
  });
});

describe("relation fields in a global-id lookup's select", () => {
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

  it("still projects the key a list lookup matches on when select names only relations", async () => {
    const calls: SQLStatement[] = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;
    const nodes = createClient({ schema: { authors, books, authorRelations }, session });
    const id = "5f0c6a38-54d2-4a4c-9d5b-3f1f2f2d8a11";

    await nodes.$listByGlobalId({
      ids: [encodeGlobalId("authors", { id })],
      on: { authors: { select: { books: { title: true } } } },
    });

    expect(calls[0]?.text).toMatch(/^SELECT "__t0"\."id", "__join_books"\."data" AS "books"/);
  });
});
