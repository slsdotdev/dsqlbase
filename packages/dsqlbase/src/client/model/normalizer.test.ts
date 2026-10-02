import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import {
  belongsTo,
  date,
  datetime,
  embedded,
  guid,
  hasMany,
  hasOne,
  json,
  numeric,
  relations,
  table,
  text,
  union,
  uuid,
} from "../../schema/index.js";
import { encodeGlobalId, GlobalIdError } from "../../schema/utils/global-id.js";

describe("RequestNormalizer read-only columns", () => {
  const invoices = table("invoices", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().readOnly(),
    number: text("number").notNull(),
  });

  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<{ invoices: typeof invoices }>>;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema: { invoices }, session });
  });

  // The field is not in `CreateValuesOf`, so it can only arrive through an untyped spread.
  // Dropping it keeps `create({ data: { ...input } })` working; refusing it would not.
  it("drops a read-only field from create data", async () => {
    await dsql.invoices.create({
      data: { number: "INV-1", workspaceId: "ws-1" } as { number: string },
    });

    expect(calls[0]?.params).toEqual(["INV-1"]);
    expect(calls[0]?.text).not.toContain("$2");
  });

  it("drops a read-only field from update set", async () => {
    await dsql.invoices.update({
      set: { number: "INV-2", workspaceId: "ws-2" } as { number: string },
      where: { number: { eq: "INV-1" } },
    });

    expect(calls[0]?.params).toEqual(["INV-2", "INV-1"]);
  });

  it("keeps a read-only column filterable, selectable and orderable", async () => {
    await dsql.invoices.findMany({
      select: { workspaceId: true },
      where: { workspaceId: { eq: "ws-1" } },
      orderBy: { workspaceId: "asc" },
    });

    expect(calls[0]?.text).toContain(`"workspace_id"`);
    expect(calls[0]?.params).toEqual(["ws-1"]);
  });
});

describe("selection", () => {
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
          dsql.posts.findMany({
            select: { id: true },
            join: { author: { select: { name: true } } },
          })
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
          () =>
            dsql.users.findMany({ select: { name: true, feed: { id: true, createdAt: true } } }),
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
});

describe("union joins", () => {
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
      expect(text_()).toContain(
        `'videos' AS "$$key", "__t2"."id", "__t2"."owner_id" FROM "videos"`
      );
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

      expect(text_()).toContain(
        `AND (("__t1"."day" IS NOT NULL) AND ("__t1"."photo_url" LIKE $1))`
      );
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
      [
        { where: { or: [{ videoUrl: "x" }] } },
        /Invalid field "videoUrl" in where for union "posts"/,
      ],
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
});

describe("polymorphic writes", () => {
  const companies = table("companies", {
    id: guid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
  });

  const persons = table("persons", {
    id: guid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
  });

  const tradingEntities = union({ companies, persons });

  const ledgerEntries = table("ledger_entries", {
    id: guid("id").primaryKey().defaultRandom(),
    counterpartyType: text("counterparty_type"),
    counterpartyId: guid("counterparty_id"),
    amount: numeric("amount").notNull(),
  });

  const ledgerRelations = relations(ledgerEntries, {
    counterparty: belongsTo(tradingEntities, {
      from: [ledgerEntries.columns.counterpartyId],
      to: [tradingEntities.columns.id],
      discriminator: ledgerEntries.columns.counterpartyType,
    }),
  });

  const schema = { companies, persons, tradingEntities, ledgerEntries, ledgerRelations };

  const COMPANY = "11111111-1111-4111-8111-111111111111";
  const PERSON = "22222222-2222-4222-8222-222222222222";
  const companyId = encodeGlobalId("companies", { id: COMPANY });
  const personId = encodeGlobalId("persons", { id: PERSON });

  describe("a polymorphic belongs-to", () => {
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

    describe("writing", () => {
      it("fills the discriminator from a global id", async () => {
        await dsql.ledgerEntries.create({ data: { counterpartyId: companyId, amount: 10 } });

        expect(text_()).toContain('"counterparty_type", "counterparty_id"');
        expect(params()).toEqual(expect.arrayContaining(["companies", COMPANY]));
      });

      it("accepts a discriminator that agrees, and refuses one that does not", () => {
        expect(() =>
          dsql.ledgerEntries.create({
            data: { counterpartyId: companyId, counterpartyType: "companies", amount: 1 },
          })
        ).not.toThrow();

        expect(() =>
          dsql.ledgerEntries.create({
            data: { counterpartyId: companyId, counterpartyType: "persons", amount: 1 },
          })
        ).toThrow(GlobalIdError);
      });

      it("refuses a global id for a table outside the union", () => {
        const entryId = encodeGlobalId("ledgerEntries", { id: COMPANY });

        expect(() =>
          dsql.ledgerEntries.create({ data: { counterpartyId: entryId, amount: 1 } })
        ).toThrow(/this column holds ids for "companies", "persons"/);
      });

      it("leaves the discriminator alone for a raw uuid, and fills it on update", async () => {
        await dsql.ledgerEntries.create({ data: { counterpartyId: COMPANY, amount: 1 } });
        expect(params()).not.toContain("companies");

        calls = [];
        await dsql.ledgerEntries.update({
          set: { counterpartyId: personId },
          where: { amount: { eq: 1 } },
        });

        expect(text_()).toContain('SET "counterparty_id" = $1, "counterparty_type" = $2');
        expect(params()?.slice(0, 2)).toEqual([PERSON, "persons"]);
      });
    });
  });
});

describe("column groups", () => {
  const money = embedded({
    amount: numeric("amount").notNull(),
    currency: text("currency").notNull(),
  });
  const geo = embedded({ lat: text("lat"), lng: text("lng") });
  const address = embedded({ city: text("city"), notes: json("notes"), geo: geo.column("geo") });

  const customers = table("customers", { id: uuid("id").primaryKey().defaultRandom() });
  const invoices = table("invoices", {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").notNull(),
    netValue: money.column("net_value"),
    billing: address.column("billing"),
  });
  const invoiceRelations = relations(invoices, {
    customer: belongsTo(customers, {
      from: [invoices.columns.customerId],
      to: [customers.columns.id],
    }),
  });

  let calls: SQLStatement[];
  let rows: Record<string, unknown>[];
  let dsql: ReturnType<
    typeof createClient<{
      customers: typeof customers;
      invoices: typeof invoices;
      invoiceRelations: typeof invoiceRelations;
    }>
  >;

  beforeEach(() => {
    calls = [];
    rows = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return rows;
      }),
    } as unknown as Session;

    dsql = createClient({ schema: { customers, invoices, invoiceRelations }, session });
  });

  const projected = () =>
    [...(calls[0]?.text.matchAll(/"((?:net_value|billing)_\w+)"/g) ?? [])].map(([, name]) => name);

  it("reads a group selected as true as one object", async () => {
    rows = [{ net_value_amount: "12.50", net_value_currency: "EUR" }];

    const [invoice] = await dsql.invoices.findMany({ select: { netValue: true } });

    expect(projected()).toEqual(["net_value_amount", "net_value_currency"]);
    expect(invoice?.netValue).toEqual({ amount: 12.5, currency: "EUR" });
  });

  it("reads the members a map names, nested groups included", async () => {
    rows = [
      { billing_city: "Cluj", billing_notes: null, billing_geo_lat: "46.7", billing_geo_lng: null },
    ];

    const [invoice] = await dsql.invoices.findMany({
      select: { billing: { city: true, geo: { lat: true } } },
    });

    expect(invoice?.billing).toEqual({ city: "Cluj", geo: { lat: "46.7" } });
  });

  it("projects a nullable group's every column, and reads it null when all are", async () => {
    rows = [
      { billing_city: null, billing_notes: null, billing_geo_lat: null, billing_geo_lng: null },
    ];

    const [invoice] = await dsql.invoices.findMany({ select: { billing: { city: true } } });

    expect(projected()).toEqual([
      "billing_city",
      "billing_notes",
      "billing_geo_lat",
      "billing_geo_lng",
    ]);
    expect(invoice?.billing).toBeNull();
  });

  it("reads every group with no select, and beside a relation", async () => {
    await dsql.invoices.findMany({});
    expect(projected()).toContain("net_value_amount");
    expect(projected()).toContain("billing_geo_lng");

    calls = [];
    await dsql.invoices.findMany({ select: { netValue: { amount: true }, customer: true } });
    expect(projected()).toEqual(["net_value_amount"]);
  });

  it("selects a group in a write's return", async () => {
    await dsql.invoices.delete({ where: { id: "i-1" }, return: { netValue: true } });

    expect(calls[0]?.text).toContain(`RETURNING`);
    expect(projected()).toEqual(["net_value_amount", "net_value_currency"]);
  });

  it("refuses a member the group does not have, and a map on a column", () => {
    expect(() => dsql.invoices.findMany({ select: { netValue: { nope: true } } as never })).toThrow(
      /Invalid field "netValue.nope"/
    );
    expect(() =>
      dsql.invoices.findMany({ select: { netValue: { amount: { x: true } } } as never })
    ).toThrow(/column "netValue.amount" of "invoices": a column takes true/);
  });

  it("orders by a member through a nested order object", async () => {
    await dsql.invoices.findMany({
      orderBy: { netValue: { amount: "desc" }, billing: { geo: { lat: "asc" } } },
    });

    expect(calls[0]?.text).toContain(
      `ORDER BY "__t0"."net_value_amount" DESC, "__t0"."billing_geo_lat" ASC`
    );
  });

  it("refuses a direction on a group, and a member that cannot be ordered", () => {
    expect(() => dsql.invoices.findMany({ orderBy: { netValue: "asc" } as never })).toThrow(
      /Cannot order by the group "netValue" of "invoices"; order by its members/
    );
    expect(() =>
      dsql.invoices.findMany({ orderBy: { billing: { notes: "asc" } } as never })
    ).toThrow(/Cannot order by the json column "billing.notes" of "invoices"/);
  });

  it("pages by a member, carrying it as a keyset key", async () => {
    await dsql.invoices.paginate({ orderBy: { netValue: { amount: "desc" } }, limit: 2 });

    expect(calls[0]?.text).toContain(`"__t0"."net_value_amount"::text AS "__k0"`);
    expect(calls[0]?.text).toContain(`ORDER BY "__t0"."net_value_amount" DESC, "__t0"."id" DESC`);
  });

  it("refuses distinct over a group projecting a column it cannot compare", () => {
    expect(() =>
      dsql.invoices.findMany({ select: { billing: { city: true } }, distinct: true })
    ).toThrow(/`distinct` cannot compare the json column "billing \(billing_notes\)"/);
  });

  describe("writes", () => {
    const audit = embedded({
      by: guid("by", "customers"),
      at: text("at")
        .readOnly()
        .$onUpdate(() => "now"),
    });
    const priced = embedded({
      amount: numeric("amount").notNull(),
      currency: text("currency").notNull().default("EUR"),
    });
    const orders = table("orders", {
      id: uuid("id").primaryKey().defaultRandom(),
      price: priced.column("price"),
      shipping: address.column("shipping").default({ city: "-" }),
      audit: audit.column("audit"),
    });
    const people = table("customers", { id: guid("id").primaryKey().defaultRandom() });

    let write: ReturnType<typeof createClient<{ orders: typeof orders; customers: typeof people }>>;

    beforeEach(() => {
      write = createClient({
        schema: { orders, customers: people },
        session: {
          execute: vi.fn(async (query: SQLStatement) => (calls.push(query), [])),
        } as unknown as Session,
      });
    });

    it("creates a group from its members, the rest taking their defaults", async () => {
      await write.orders.create({ data: { price: { amount: 5 } } });

      expect(calls[0]?.text).toContain(
        `("id", "price_amount", "price_currency", "shipping_city", "shipping_notes", ` +
          `"shipping_geo_lat", "shipping_geo_lng", "audit_by", "audit_at")`
      );
      expect(calls[0]?.text).toContain(
        `VALUES (DEFAULT, $1, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT, DEFAULT)`
      );
      expect(calls[0]?.params).toEqual(["5"]);
    });

    it("updates only the members named, and runs a member's $onUpdate", async () => {
      await write.orders.update({ where: { id: "o-1" }, set: { shipping: { geo: { lat: "1" } } } });

      expect(calls[0]?.text).toContain(`SET "shipping_geo_lat" = $1, "audit_at" = $2`);
      expect(calls[0]?.params).toEqual(["1", "now", "o-1"]);
    });

    it("sets every column NULL for a null group, and refuses null on a group that is never null", async () => {
      await write.orders.update({ where: { id: "o-1" }, set: { shipping: null } });

      expect(calls[0]?.text).toContain(
        `SET "shipping_city" = $1, "shipping_notes" = $2, "shipping_geo_lat" = $3, ` +
          `"shipping_geo_lng" = $4`
      );
      expect(() =>
        write.orders.update({ where: { id: "o-1" }, set: { price: null } as never })
      ).toThrow(/Cannot set the group "price" of "orders" to null/);
    });

    it("writes a guid member as the raw id, and drops a read-only member", async () => {
      const id = "8f14e45f-ceea-467a-9575-6a1f3b3f2c11";

      await write.orders.create({
        data: {
          price: { amount: 1 },
          audit: { by: encodeGlobalId("customers", { id }), at: "x" } as never,
        },
      });

      expect(calls[0]?.params).toEqual(["1", id]);
    });

    it("refuses a member the group does not have, and a value that is not an object", () => {
      expect(() =>
        write.orders.create({ data: { price: { amount: 1, nope: 2 } } as never })
      ).toThrow(/Invalid field "price.nope" in values for table "orders"/);
      expect(() => write.orders.create({ data: { price: 5 } as never })).toThrow(
        /Write the group "price" of "orders" as an object of its members, or null/
      );
    });
  });
});
