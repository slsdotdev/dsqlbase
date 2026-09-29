import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { InvalidCursorError, keysetSignature } from "../pagination/cursor.js";
import { UnionClient } from "./client.js";
import { datetime, table, tenantScope, text, union, uuid } from "../../schema/index.js";

const photos = table("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  caption: text("caption"),
  photoUrl: text("photo_url").notNull(),
});

const videos = table("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("owner_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  caption: text("caption"),
  videoUrl: text("video_url").notNull(),
});

const posts = union({ photos, videos });

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
            owner_id: "u1",
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
    expect(text_()).toContain(`WHERE "__t1"."owner_id" = $2`);
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
        owner_id: "u1",
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

  describe("tenancy", () => {
    const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });
    const notes = ws.table("notes", { id: uuid("id").primaryKey(), title: text("title") });
    const links = table("links", { id: uuid("id").primaryKey(), title: text("title") });
    const items = union({ notes, links });
    const scoped = { notes, links, items };

    it("filters the scoped member's branch and refuses a claimless client", async () => {
      const execute = vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      });
      const base = createClient({ schema: scoped, session: { execute } as unknown as Session });

      // Hidden by the type as well, since one member needs a claim this client lacks.
      // @ts-expect-error `items` is not visible on a claimless enforcing client
      expect(() => base.items.findMany()).toThrow(/tenant-scoped/);

      await base.$identityClaims({ workspaceId: "w1" }).items.findMany();

      expect(text_()).toContain(`FROM "notes" AS "__t0" WHERE "__t0"."workspace_id" = $1`);
      expect(text_()).toMatch(/FROM "links" AS "__t1"\) AS "__j1"$/);
    });
  });
});
