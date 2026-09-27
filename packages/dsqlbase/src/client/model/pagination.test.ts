import { describe, expect, it, vi } from "vitest";
import { TenancyError, type Session, type SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { date, datetime, table, tenantScope, text, uuid } from "../../schema/index.js";
import { InvalidCursorError } from "../pagination/cursor.js";

const tasks = table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  createdAt: datetime("created_at").notNull(),
  dueDate: date("due_date"),
});

const logs = table("logs", {
  line: text("line").notNull(),
});

const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });

const invoices = ws.table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
});

const schema = { tasks, logs, invoices };

/** A raw driver row for `tasks`, with the hidden keys a keyset select projects. */
const row = (n: number) => ({
  id: `id-${n}`,
  title: `Task ${n}`,
  created_at: `2026-09-27 12:00:00.00000${n}+00`,
  due_date: null,
  __k0: `2026-09-27 12:00:00.00000${n}+00`,
  __k1: `id-${n}`,
});

/**
 * A client whose session answers a count with `total` and every other statement with `rows`,
 * recording what it was asked to run.
 */
const setup = (
  options: { rows?: unknown[]; total?: string; pagination?: object; enforce?: boolean } = {}
) => {
  const statements: SQLStatement[] = [];

  const session = {
    execute: vi.fn(async (query: SQLStatement) => {
      statements.push(query);
      return query.text.startsWith("SELECT count(*)")
        ? [{ count: options.total ?? "0" }]
        : (options.rows ?? []);
    }),
  } as unknown as Session;

  const dsql = createClient({
    schema,
    session,
    pagination: options.pagination,
    tenancy: { enforce: options.enforce ?? true },
  });

  return { dsql, statements, last: () => statements.at(-1) };
};

const firstPageSQL =
  `SELECT "__t0"."id", "__t0"."title", "__t0"."created_at", "__t0"."due_date", ` +
  `"__t0"."created_at"::text AS "__k0", "__t0"."id"::text AS "__k1" ` +
  `FROM "tasks" AS "__t0" ORDER BY "__t0"."created_at" DESC, "__t0"."id" DESC LIMIT $1`;

describe("ModelClient.paginate / the select it builds", () => {
  it("orders by the caller's keys then the primary key, projects them as text, reads one more", async () => {
    const { dsql, last } = setup();

    await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });

    expect(last()?.text).toBe(firstPageSQL);
    expect(last()?.params).toEqual([3]);
  });

  it("does not append a primary key the caller already ordered by", async () => {
    const { dsql, last } = setup();

    await dsql.tasks.paginate({ orderBy: { id: "asc", title: "asc" }, limit: 2 });

    expect(last()?.text).toContain(`ORDER BY "__t0"."id" ASC, "__t0"."title" ASC LIMIT`);
  });

  it("orders by the primary key ascending when the caller named no order", async () => {
    const { dsql, last } = setup();

    await dsql.tasks.paginate({ limit: 2 });

    expect(last()?.text).toContain(`ORDER BY "__t0"."id" ASC LIMIT`);
  });

  it("reads the client's defaultLimit when the call names none", async () => {
    const { dsql, last } = setup({ pagination: { defaultLimit: 25 } });

    await dsql.tasks.paginate({});

    expect(last()?.params).toEqual([26]);
  });

  it("defaults to 100 when neither names a limit", async () => {
    const { dsql, last } = setup();

    await dsql.tasks.paginate({});

    expect(last()?.params).toEqual([101]);
  });

  it("puts the keyset after the caller's filter", async () => {
    const { dsql, last } = setup({ rows: [row(1), row(2), row(3)] });

    const first = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });
    await dsql.tasks.paginate({
      where: { title: { beginsWith: "Task" } },
      orderBy: { createdAt: "desc" },
      limit: 2,
      after: first.endCursor,
    });

    expect(last()?.text).toContain(
      `WHERE ("__t0"."title" LIKE $1) AND ` +
        `("__t0"."created_at" < $2 OR ("__t0"."created_at" = $3 AND "__t0"."id" < $4))`
    );
    // The cursor's key values, verbatim — microseconds and all.
    expect(last()?.params).toEqual([
      "Task%",
      "2026-09-27 12:00:00.000002+00",
      "2026-09-27 12:00:00.000002+00",
      "id-2",
      3,
    ]);
  });

  it("reads a page before the cursor with every direction flipped", async () => {
    const { dsql, last } = setup({ rows: [row(1), row(2), row(3)] });

    const first = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });
    await dsql.tasks.paginate({
      orderBy: { createdAt: "desc" },
      limit: 2,
      before: first.startCursor,
    });

    expect(last()?.text).toContain(
      `WHERE "__t0"."created_at" > $1 OR ("__t0"."created_at" = $2 AND "__t0"."id" > $3) ` +
        `ORDER BY "__t0"."created_at" ASC, "__t0"."id" ASC`
    );
  });

  it("scopes a tenant table's page, with the tenant predicate first", async () => {
    const { dsql, last } = setup({
      rows: [{ id: "i1", number: "1", workspace_id: "w1", __k0: "i1" }],
    });
    const acme = dsql.$identityClaims({ workspaceId: "w1" });

    const first = await acme.invoices.paginate({ limit: 1 });
    await acme.invoices.paginate({ limit: 1, after: first.endCursor });

    expect(last()?.text).toContain(`WHERE ("__t0"."workspace_id" = $1) AND ("__t0"."id" > $2)`);
  });

  it("refuses a tenant table on a client with no claims, for a page and for a count", () => {
    const { dsql } = setup();
    // Absent from an enforcing client's type, but still reachable untyped — which is what the
    // runtime refusal is for.
    const { invoices: untyped } = dsql as unknown as {
      invoices: { paginate(args: object): unknown; count(): unknown };
    };

    expect(() => untyped.paginate({})).toThrow(TenancyError);
    expect(() => untyped.count()).toThrow(TenancyError);
  });
});

describe("ModelClient.paginate / nullable order keys", () => {
  /** A raw `tasks` row ordered by `dueDate`, whose first hidden key is the due date's text. */
  const dueRow = (n: number, due: string | null) => ({
    ...row(n),
    due_date: due,
    __k0: due,
    __k1: `id-${n}`,
  });

  it("places the nulls explicitly: last ascending", async () => {
    const { dsql, last } = setup();

    await dsql.tasks.paginate({ orderBy: { dueDate: "asc" }, limit: 2 });

    expect(last()?.text).toContain(
      `ORDER BY "__t0"."due_date" ASC NULLS LAST, "__t0"."id" ASC LIMIT`
    );
  });

  it("places the nulls explicitly: first descending", async () => {
    const { dsql, last } = setup();

    await dsql.tasks.paginate({ orderBy: { dueDate: "desc" }, limit: 2 });

    expect(last()?.text).toContain(
      `ORDER BY "__t0"."due_date" DESC NULLS FIRST, "__t0"."id" DESC LIMIT`
    );
  });

  it("leaves a key that cannot hold NULL without a placement", async () => {
    const { dsql, last } = setup();

    await dsql.tasks.paginate({ orderBy: { createdAt: "asc" }, limit: 2 });

    expect(last()?.text).not.toContain("NULLS");
  });

  it("continues past a value into the nulls sorted after it", async () => {
    const { dsql, last } = setup({ rows: [dueRow(1, "2026-05-01"), dueRow(2, null)] });

    const first = await dsql.tasks.paginate({ orderBy: { dueDate: "asc" }, limit: 1 });
    await dsql.tasks.paginate({ orderBy: { dueDate: "asc" }, limit: 1, after: first.endCursor });

    expect(last()?.text).toContain(
      `WHERE "__t0"."due_date" > $1 OR "__t0"."due_date" IS NULL OR ` +
        `("__t0"."due_date" = $2 AND "__t0"."id" > $3)`
    );
  });

  it("continues from a null among the nulls, carrying the null in the cursor", async () => {
    const { dsql, last } = setup({ rows: [dueRow(1, null), dueRow(2, null)] });

    const first = await dsql.tasks.paginate({ orderBy: { dueDate: "asc" }, limit: 1 });
    await dsql.tasks.paginate({ orderBy: { dueDate: "asc" }, limit: 1, after: first.endCursor });

    expect(last()?.text).toContain(`WHERE "__t0"."due_date" IS NULL AND "__t0"."id" > $1`);
    expect(last()?.params).toEqual(["id-1", 2]);
  });

  it("reads before a null with the order and its null placement flipped", async () => {
    const { dsql, last } = setup({ rows: [dueRow(1, null), dueRow(2, null)] });

    const first = await dsql.tasks.paginate({ orderBy: { dueDate: "asc" }, limit: 1 });
    await dsql.tasks.paginate({ orderBy: { dueDate: "asc" }, limit: 1, before: first.endCursor });

    expect(last()?.text).toContain(
      `WHERE "__t0"."due_date" IS NOT NULL OR ("__t0"."due_date" IS NULL AND "__t0"."id" < $1) ` +
        `ORDER BY "__t0"."due_date" DESC NULLS FIRST, "__t0"."id" DESC`
    );
  });
});

describe("ModelClient.paginate / the page it returns", () => {
  it("keeps `limit` rows and reports the extra one as a next page", async () => {
    const { dsql } = setup({ rows: [row(1), row(2), row(3)] });

    const page = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual(["id-1", "id-2"]);
    expect(page.hasNextPage).toBe(true);
    expect(page.hasPreviousPage).toBe(false);
  });

  it("reports no next page when the extra row did not come back", async () => {
    const { dsql } = setup({ rows: [row(1), row(2)] });

    const page = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });

    expect(page.hasNextPage).toBe(false);
  });

  it("reports a previous page whenever it was read after a cursor", async () => {
    const { dsql } = setup({ rows: [row(1), row(2)] });

    const first = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 1 });
    const second = await dsql.tasks.paginate({
      orderBy: { createdAt: "desc" },
      limit: 1,
      after: first.endCursor,
    });

    expect(second.hasPreviousPage).toBe(true);
  });

  it("stamps each record's cursor and keeps the hidden keys off it", async () => {
    const { dsql } = setup({ rows: [row(1), row(2), row(3)] });

    const page = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });

    expect(page.items[0]?.$$meta).toEqual({
      key: "tasks",
      table: "tasks",
      cursor: page.startCursor,
    });
    expect(page.items[1]?.$$meta.cursor).toBe(page.endCursor);
    expect(page.items[0]).not.toHaveProperty("__k0");
  });

  it("does not write the cursor into the table's shared meta", async () => {
    const { dsql } = setup({ rows: [row(1)] });

    await dsql.tasks.paginate({ limit: 1 });
    const [plain] = await dsql.tasks.findMany({});

    expect(plain?.$$meta).not.toHaveProperty("cursor");
  });

  it("puts a page read before the cursor back in order", async () => {
    // Read backwards, the driver returns nearest-the-cursor first, plus the extra row.
    const { dsql } = setup({ rows: [row(5), row(4), row(3)] });

    const first = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });
    const page = await dsql.tasks.paginate({
      orderBy: { createdAt: "desc" },
      limit: 2,
      before: first.endCursor,
    });

    expect(page.items.map((item) => item.id)).toEqual(["id-4", "id-5"]);
    expect(page.hasPreviousPage).toBe(true);
    expect(page.hasNextPage).toBe(true);
    expect(page.startCursor).toBe(page.items[0]?.$$meta.cursor);
  });

  it("returns an empty page with no cursors", async () => {
    const { dsql } = setup({ rows: [] });

    const page = await dsql.tasks.paginate({});

    expect(page).toEqual({
      items: [],
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
  });
});

describe("ModelClient.paginate / count", () => {
  it("adds totalCount from a second statement over the caller's filter alone", async () => {
    const { dsql, statements } = setup({ rows: [row(1), row(2), row(3)], total: "7" });

    const first = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 2 });
    statements.length = 0;

    const page = await dsql.tasks.paginate({
      where: { title: "Task 1" },
      orderBy: { createdAt: "desc" },
      limit: 2,
      after: first.endCursor,
      count: true,
    });

    expect(page.totalCount).toBe(7);
    expect(statements.map((statement) => statement.text)).toContain(
      `SELECT count(*) AS "count" FROM "tasks" AS "__t0" WHERE "__t0"."title" = $1`
    );
  });

  it("leaves totalCount off when count was not asked for", async () => {
    const { dsql, statements } = setup({ rows: [row(1)] });

    const page = await dsql.tasks.paginate({ limit: 1 });

    expect(page).not.toHaveProperty("totalCount");
    expect(statements).toHaveLength(1);
  });
});

describe("ModelClient.count", () => {
  it("counts every row without a where", async () => {
    const { dsql, last } = setup({ total: "12" });

    await expect(dsql.tasks.count()).resolves.toBe(12);
    expect(last()?.text).toBe(`SELECT count(*) AS "count" FROM "tasks" AS "__t0"`);
  });

  it("encodes its filter through the column codec, like findMany", async () => {
    const { dsql, last } = setup({ total: "1" });

    await dsql.tasks.count({ where: { dueDate: new Date("2026-05-01T00:00:00Z") } });

    expect(last()?.params).toEqual(["2026-05-01"]);
  });

  it("is scoped on a derived client", async () => {
    const { dsql, last } = setup({ total: "1" });

    await dsql.$identityClaims({ workspaceId: "w1" }).invoices.count();

    expect(last()?.text).toBe(
      `SELECT count(*) AS "count" FROM "invoices" AS "__t0" WHERE "__t0"."workspace_id" = $1`
    );
  });
});

describe("ModelClient.paginate / refusals", () => {
  const cursorOf = async (orderBy: object) => {
    const { dsql } = setup({ rows: [row(1), row(2)] });
    const page = await dsql.tasks.paginate({ orderBy, limit: 1 });
    return page.endCursor as string;
  };

  it("refuses after and before together", async () => {
    const { dsql } = setup();
    const cursor = await cursorOf({});

    expect(() => dsql.tasks.paginate({ after: cursor, before: cursor })).toThrow(
      /either after or before/
    );
  });

  it("treats a null after or before as absent", () => {
    const { dsql } = setup();

    expect(() => dsql.tasks.paginate({ after: null, before: null })).not.toThrow();
  });

  it.each([0, -1, 1.5])("refuses a limit of %s", (limit) => {
    const { dsql } = setup();

    expect(() => dsql.tasks.paginate({ limit })).toThrow(/positive integer/);
  });

  it("refuses a limit above maxLimit", () => {
    const { dsql } = setup({ pagination: { maxLimit: 50 } });

    expect(() => dsql.tasks.paginate({ limit: 51 })).toThrow(/51 exceeds .* maxLimit of 50/);
  });

  it("refuses a table with no primary key", () => {
    const { dsql } = setup();

    expect(() => dsql.logs.paginate({})).toThrow(/no primary key/);
  });

  it("refuses a cursor taken under another order", async () => {
    const { dsql } = setup();
    const cursor = await cursorOf({ createdAt: "desc" });

    expect(() => dsql.tasks.paginate({ orderBy: { createdAt: "asc" }, after: cursor })).toThrow(
      InvalidCursorError
    );
  });

  it("refuses a cursor carrying a null for a key that cannot hold one", async () => {
    const { dsql } = setup({ rows: [{ ...row(1), __k0: null }, row(2)] });
    const page = await dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, limit: 1 });

    expect(() =>
      dsql.tasks.paginate({ orderBy: { createdAt: "desc" }, after: page.endCursor })
    ).toThrow(InvalidCursorError);
  });
});

describe("createClient pagination options", () => {
  const session = { execute: vi.fn() } as unknown as Session;

  it.each([{ defaultLimit: 0 }, { maxLimit: 2.5 }])("refuses %o", (pagination) => {
    expect(() => createClient({ schema, session, pagination })).toThrow(/positive integer/);
  });

  it("refuses a defaultLimit above maxLimit", () => {
    expect(() =>
      createClient({ schema, session, pagination: { defaultLimit: 20, maxLimit: 10 } })
    ).toThrow(/exceeds pagination.maxLimit/);
  });
});
