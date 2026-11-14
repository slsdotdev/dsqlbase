import { AnyTable, AnyUnion } from "@dsqlbase/core";
import { describe, expect, it } from "vitest";
import { PaginatedQueryArgs } from "./base.js";
import { MockSchema, context } from "../../../mocks/context.js";

const paginate = <T extends AnyTable, TArgs extends PaginatedQueryArgs<T, MockSchema>>(
  table: T,
  query: TArgs
) => {
  const request = context.normalizer.createSelectRequest(table, query, "many");
  const withPagination = context.pagination.paginateRequest(table, query, request);
  const operation = context.operations.createSelectOperation(table, request);

  return withPagination(operation);
};

const unionPaginate = <
  TUnion extends AnyUnion,
  TArgs extends PaginatedQueryArgs<TUnion, MockSchema>,
>(
  union: TUnion,
  query: TArgs
) => {
  const request = context.normalizer.createUnionSelectRequest(union, query, "many");
  const withPagination = context.pagination.paginateUnionRequest(union, query, request);
  const operation = context.operations.createUnionSelectOperation(union, request);

  return withPagination(operation);
};

const record = (index: number) => ({
  id: `id-${index}`,
  title: `Title ${index}`,
  created_at: `2026-09-27 12:00:00.00000${index}+00`,
  __k0: `2026-09-27 12:00:00.00000${index}+00`,
  __k1: `id-${index}`,
});

const unionRecord = (key: string, index: number) => ({
  data: {
    $$key: key,
    id: `id-${index}`,
    user_id: "u1",
    created_at: `2026-01-0${3 - index}T00:00:00Z`,
    photo_url: "a",
    video_url: "b",
  },
  __k0: `2026-01-0${3 - index}T00:00:00Z`,
  __k1: key,
  __k2: `id-${index}`,
});

describe("PaginationHandler", () => {
  it("appends primary key to order by and projections", () => {
    const table = context.schema.getTable("posts");

    const { query } = paginate(table, {
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      limit: 2,
    });

    expect(query).toEqual({
      text:
        `SELECT "__t0"."id", "__t0"."title", ` +
        `"__t0"."created_at"::text AS "__k0", "__t0"."id"::text AS "__k1" ` +
        `FROM "posts" AS "__t0" ORDER BY "__t0"."created_at" DESC, "__t0"."id" DESC LIMIT $1`,
      params: [3],
    });
  });

  it("does not appped primary key when declared", () => {
    const table = context.schema.getTable("posts");

    const { query } = paginate(table, {
      select: { id: true, title: true },
      orderBy: { id: "asc", createdAt: "desc" },
      limit: 2,
    });

    expect(query.text).toBe(
      `SELECT "__t0"."id", "__t0"."title", ` +
        `"__t0"."id"::text AS "__k0", "__t0"."created_at"::text AS "__k1" ` +
        `FROM "posts" AS "__t0" ORDER BY "__t0"."id" ASC, "__t0"."created_at" DESC LIMIT $1`
    );
  });

  it("orders by primary key when no order is declared", () => {
    const table = context.schema.getTable("posts");

    const { query } = paginate(table, {
      select: { id: true, title: true },
      limit: 2,
    });

    expect(query.text).toBe(
      `SELECT "__t0"."id", "__t0"."title", ` +
        `"__t0"."id"::text AS "__k0" ` +
        `FROM "posts" AS "__t0" ORDER BY "__t0"."id" ASC LIMIT $1`
    );
  });

  it("uses default limit when none is specified", () => {
    const table = context.schema.getTable("posts");

    const { query } = paginate(table, {
      select: { id: true, title: true },
    });

    expect(query.params).toEqual([101]);
  });

  it("adds keyset clause after declared filter", () => {
    const table = context.schema.getTable("posts");

    const firstPage = paginate(table, {
      select: { id: true, title: true },
      where: { title: { eq: "Hello" } },
      orderBy: { createdAt: "desc" },
      limit: 2,
    }).resolve([record(1), record(2), record(3)]);

    const { query } = paginate(table, {
      select: { id: true, title: true },
      where: { title: { beginsWith: "Hello" } },
      orderBy: { createdAt: "desc" },
      limit: 2,
      after: firstPage.nextCursor,
    });

    expect(query.text).toContain(
      `WHERE ("__t0"."title" LIKE $1) AND ` +
        `("__t0"."created_at" < $2 OR ("__t0"."created_at" = $3 AND "__t0"."id" < $4))`
    );

    expect(query.params).toEqual([
      "Hello%",
      "2026-09-27 12:00:00.000002+00",
      "2026-09-27 12:00:00.000002+00",
      "id-2",
      3,
    ]);
  });

  it("reads a page before the cursor with every direction flipped", () => {
    const table = context.schema.getTable("posts");

    const firstPage = paginate(table, {
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      limit: 2,
    }).resolve([record(1), record(2), record(3)]);

    const { query } = paginate(table, {
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      limit: 2,
      before: firstPage.nextCursor,
    });

    expect(query.text).toContain(
      `WHERE "__t0"."created_at" > $1 OR ("__t0"."created_at" = $2 AND "__t0"."id" > $3) ` +
        `ORDER BY "__t0"."created_at" ASC, "__t0"."id" ASC`
    );
  });

  describe("cursor", () => {
    const table = context.schema.getTable("posts");

    const { nextCursor: cursor } = paginate(table, {
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      limit: 2,
    }).resolve([record(1), record(2), record(3)]);

    it("refuses after and before together", () => {
      expect(() =>
        paginate(table, {
          after: cursor,
          before: cursor,
        })
      ).toThrow(/either after or before/);
    });

    it("refuses a cursor taken under another order", () => {
      expect(() =>
        paginate(table, {
          orderBy: { createdAt: "asc" },
          after: cursor,
        })
      ).toThrow(/was taken under another table or order;/);
    });
  });

  describe("union", () => {
    it("paginates a union", () => {
      const union = context.schema.getUnion("media");

      const { query } = unionPaginate(union, {
        select: { id: true },
        orderBy: { createdAt: "desc" },
        limit: 2,
      });

      expect(query.text).toBe(
        `SELECT row_to_json("__j0".*) AS "data", ` +
          `"__j0"."__o0", "__j0"."$$key", "__j0"."__pk0", "__j0"."__k0", "__j0"."__k1", "__j0"."__k2" ` +
          `FROM (SELECT 'photos' AS "$$key", "__t0"."id", "__t0"."created_at" AS "__o0", "__t0"."id" AS "__pk0", "__t0"."created_at"::text AS "__k0", 'photos'::text AS "__k1", "__t0"."id"::text AS "__k2" FROM "photos" AS "__t0" ORDER BY "__t0"."created_at" DESC, "__t0"."id" DESC LIMIT $1) AS "__j0" ` +
          `UNION ALL SELECT row_to_json("__j1".*) AS "data", ` +
          `"__j1"."__o0", "__j1"."$$key", "__j1"."__pk0", "__j1"."__k0", "__j1"."__k1", "__j1"."__k2" FROM (SELECT 'videos' AS "$$key", "__t1"."id", "__t1"."created_at" AS "__o0", "__t1"."id" AS "__pk0", "__t1"."created_at"::text AS "__k0", 'videos'::text AS "__k1", "__t1"."id"::text AS "__k2" FROM "videos" AS "__t1" ORDER BY "__t1"."created_at" DESC, "__t1"."id" DESC LIMIT $2) AS "__j1" ` +
          `ORDER BY "__o0" DESC, "$$key" DESC, "__pk0" DESC LIMIT $3`
      );
    });

    it("orders by key and primary key when paged with no orderBy", () => {
      const union = context.schema.getUnion("media");

      const { query } = unionPaginate(union, {
        select: { id: true },
        limit: 2,
        keys: true,
      });

      expect(query.text).toContain(`ORDER BY "$$key" ASC, "__pk0" ASC LIMIT $3`);
    });

    it("continues after cursor with keyset clause in every branch", () => {
      const union = context.schema.getUnion("media");

      const page = unionPaginate(union, {
        select: { id: true },
        orderBy: { createdAt: "desc" },
        limit: 1,
      }).resolve([unionRecord("photos", 0), unionRecord("videos", 1)]);

      const { query } = unionPaginate(union, {
        select: { id: true },
        orderBy: { createdAt: "desc" },
        limit: 1,
        after: page.nextCursor,
      });

      expect(query.text).toContain(
        `SELECT row_to_json("__j0".*) AS "data", ` +
          `"__j0"."__o0", "__j0"."$$key", "__j0"."__pk0", "__j0"."__k0", "__j0"."__k1", "__j0"."__k2" ` + // Photos keys selection
          `FROM (SELECT 'photos' AS "$$key", "__t0"."id", "__t0"."created_at" AS "__o0", "__t0"."id" AS "__pk0", "__t0"."created_at"::text AS "__k0", 'photos'::text AS "__k1", "__t0"."id"::text AS "__k2" FROM "photos" AS "__t0" ` + // Photos subquery
          `WHERE "__t0"."created_at" < $1 OR ("__t0"."created_at" = $2 AND ('photos' < $3 OR ('photos' = $4 AND "__t0"."id" < $5))) ` + // Photos keyset clause
          `ORDER BY "__t0"."created_at" DESC, "__t0"."id" DESC LIMIT $6) AS "__j0" ` + // Photos order
          `UNION ALL SELECT row_to_json("__j1".*) AS "data", ` +
          `"__j1"."__o0", "__j1"."$$key", "__j1"."__pk0", "__j1"."__k0", "__j1"."__k1", "__j1"."__k2" ` + // Videos keys selection
          `FROM (SELECT 'videos' AS "$$key", "__t1"."id", "__t1"."created_at" AS "__o0", "__t1"."id" AS "__pk0", "__t1"."created_at"::text AS "__k0", 'videos'::text AS "__k1", "__t1"."id"::text AS "__k2" FROM "videos" AS "__t1" ` + // Videos subquery
          `WHERE "__t1"."created_at" < $7 OR ("__t1"."created_at" = $8 AND ('videos' < $9 OR ('videos' = $10 AND "__t1"."id" < $11))) ` + // Videos keyset clause
          `ORDER BY "__t1"."created_at" DESC, "__t1"."id" DESC LIMIT $12) AS "__j1" ` + // Videos order
          `ORDER BY "__o0" DESC, "$$key" DESC, "__pk0" DESC LIMIT $13` // Final order
      );
    });

    it("flips directions on every key when paged with before cursor", () => {
      const union = context.schema.getUnion("media");

      const page = unionPaginate(union, {
        select: { id: true },
        orderBy: { createdAt: "desc" },
        limit: 2,
      }).resolve([unionRecord("photos", 0), unionRecord("videos", 1), unionRecord("photos", 2)]);

      const { query } = unionPaginate(union, {
        select: { id: true },
        orderBy: { createdAt: "desc" },
        limit: 2,
        before: page.nextCursor,
      });

      expect(query.text).toContain(
        `WHERE "__t0"."created_at" < $1 OR ("__t0"."created_at" = $2 AND ('photos' < $3 OR ('photos' = $4 AND "__t0"."id" < $5)))` // Photos keyset clause
      );
      expect(query.text).toContain(
        `WHERE "__t1"."created_at" < $7 OR ("__t1"."created_at" = $8 AND ('videos' < $9 OR ('videos' = $10 AND "__t1"."id" < $11)))` // Videos keyset clause
      );
      expect(query.text).toContain(`ORDER BY "__o0" ASC, "$$key" ASC, "__pk0" ASC LIMIT $13`);
    });
  });
});
