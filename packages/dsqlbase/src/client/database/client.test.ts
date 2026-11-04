import { describe, expect, it, vi } from "vitest";
import { type Session, sql, type SQLStatement, TenancyError } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { ModelClient } from "../model/client.js";
import { guid, hasMany, relations, table, tenantScope, text, uuid } from "../../schema/index.js";
import { encodeGlobalId } from "../../schema/utils/global-id.js";

const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });

const workspaces = table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const invoices = ws.table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
});

const workspaceRelations = relations(workspaces, {
  invoices: hasMany(invoices, {
    from: [workspaces.columns.id],
    to: [invoices.columns.workspaceId],
  }),
});

const schema = { workspaces, invoices, workspaceRelations };

/**
 * A client plus the statements its session was asked to run — where the SQL a query built is
 * observable, since `ExecutableQuery` keeps its operation to itself.
 */
const setup = (options: { enforce?: boolean } = {}) => {
  const statements: SQLStatement[] = [];

  const session = {
    execute: vi.fn(async (query: SQLStatement) => {
      statements.push(query);
      return [];
    }),
  } as unknown as Session;

  return {
    dsql: createClient({ schema, session, tenancy: { enforce: options.enforce ?? true } }),
    last: () => statements.at(-1),
  };
};

const scopedInvoiceSelect =
  `SELECT "__t0"."workspace_id", "__t0"."id", "__t0"."number" ` +
  `FROM "invoices" AS "__t0" WHERE "__t0"."workspace_id" = $1`;

describe("DatabaseClient.$identityClaims", () => {
  it("scopes every read the derived client builds", async () => {
    const { dsql, last } = setup();

    await dsql.$identityClaims({ workspaceId: "w1" }).invoices.findMany({});

    // Aliased like every other reference in a select tree, so the predicate goes through the
    // same machinery as the caller's own conditions rather than a second one.
    expect(last()?.text).toBe(scopedInvoiceSelect);
    expect(last()?.params).toEqual(["w1"]);
  });

  it("leaves the client it was derived from unscoped", async () => {
    const { dsql, last } = setup({ enforce: false });

    dsql.$identityClaims({ workspaceId: "w1" });
    await dsql.invoices.findMany({});

    expect(last()?.text).not.toContain("WHERE");
  });

  it("accepts an identity carrying keys the schema does not declare", async () => {
    const { dsql, last } = setup();
    const token = { workspaceId: "w1", sub: "user-1", exp: 1_700_000_000 };

    // A caller should be able to hand over a decoded token whole; the declared claims are
    // picked out of it and the rest ignored.
    await dsql.$identityClaims({ ...token }).invoices.findMany({});

    expect(last()?.params).toEqual(["w1"]);
  });

  it("throws when a declared claim is given as null or undefined", () => {
    expect(() => setup().dsql.$identityClaims({ workspaceId: null as unknown as string })).toThrow(
      /Claim "workspaceId" was given as null/
    );
    expect(() =>
      setup().dsql.$identityClaims({ workspaceId: undefined as unknown as string })
    ).toThrow(TenancyError);
  });

  it("does not catch a misspelled claim, which surfaces at the first tenant table", () => {
    // Nothing here to compare a spread-in key against, so the mistake has to surface later.
    const scoped = setup().dsql.$identityClaims({
      ...{ workspacesId: "w1" },
    } as unknown as { workspaceId: string });

    expect(() => scoped.invoices.findMany({})).toThrow(/scoped by claim "workspaceId"/);
  });

  it("attaches its own models, not the ones the client it derived from holds", () => {
    const { dsql } = setup({ enforce: false });
    const scoped = dsql.$identityClaims({ workspaceId: "w1" });

    expect(scoped.invoices).toBeInstanceOf(ModelClient);
    expect(scoped.invoices).not.toBe(dsql.invoices);
    expect(scoped.workspaces).not.toBe(dsql.workspaces);
  });
});

/**
 * The types remove `$query`, `$execute` and `$identityClaims` from a scoped client, so these
 * guards only ever fire for a caller who got past them — a JavaScript consumer, or one holding
 * the client through a widened type. That is what the cast reproduces.
 */
// A `sql` template has no `text`: passed here, the session would have run nothing, silently.
describe("DatabaseClient.$execute", () => {
  it("refuses a sql template, naming $query", async () => {
    const { dsql, last } = setup();

    await expect(dsql.$execute(sql`SELECT 1` as never)).rejects.toThrow(
      /\$execute takes a rendered statement .* pass a sql`…` template to \$query/
    );
    expect(last()).toBeUndefined();
  });

  it("runs a rendered statement", async () => {
    const { dsql, last } = setup();

    await dsql.$execute(sql`SELECT 1`.toQuery());
    expect(last()?.text).toBe("SELECT 1");
  });
});

describe("DatabaseClient guards on a scoped client", () => {
  const scoped = () =>
    setup().dsql.$identityClaims({ workspaceId: "w1" }) as unknown as ReturnType<
      typeof setup
    >["dsql"];

  it("refuses $query and $execute, because raw SQL is not tenant-safe", async () => {
    expect(() => scoped().$query(sql`SELECT 1`)).toThrow(/not tenant-safe/);
    await expect(scoped().$execute(sql`SELECT 1`.toQuery())).rejects.toThrow(TenancyError);
  });

  it("refuses to be re-scoped", () => {
    expect(() => scoped().$identityClaims({ workspaceId: "w2" })).toThrow(/already scoped/);
  });

  it("still allows raw SQL on the client it derived from", () => {
    expect(() => setup().dsql.$query(sql`SELECT 1`)).not.toThrow();
  });
});

describe("DatabaseClient tenancy enforcement", () => {
  it("refuses a tenant table reached through a join, which the types cannot see", () => {
    expect(() => setup().dsql.workspaces.findMany({ join: { invoices: true } })).toThrow(
      /Table "invoices" is tenant-scoped/
    );
  });

  it("runs unscoped when enforcement is off", async () => {
    const { dsql, last } = setup({ enforce: false });

    await dsql.invoices.findMany({});

    expect(last()?.text).not.toContain("WHERE");
  });

  it("still refuses an insert with no claims when enforcement is off", () => {
    expect(() =>
      setup({ enforce: false }).dsql.invoices.create({ data: { number: "INV-1" } })
    ).toThrow(/without claim "workspaceId"/);
  });

  it("fills the claim on a scoped insert and drops a value spread into the data", async () => {
    const { dsql, last } = setup();

    await dsql.$identityClaims({ workspaceId: "w1" }).invoices.create({
      data: { number: "INV-1", ...{ workspaceId: "w2" } },
    });

    // The normalizer drops the field, so the claim wins rather than the caller's input.
    expect(last()?.params).toEqual(["w1", "INV-1"]);
  });
});

/* -------------------------------------------------------------------------------------------
 * Global ids
 * ---------------------------------------------------------------------------------------- */

const authors = table("authors", {
  id: guid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const articles = table("articles", {
  id: guid("id").primaryKey().defaultRandom(),
  authorId: guid("author_id").notNull(),
  title: text("title").notNull(),
});

const teams = table("teams", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
});

const articleTags = table("article_tags", {
  articleId: guid("article_id"),
  tagId: uuid("tag_id"),
});

// Not chained: `primaryKey()` returns the constraint, not the table.
articleTags.primaryKey((c) => [c.articleId, c.tagId]);

const nodeSchema = { authors, articles, teams, articleTags };

const AUTHOR_UUID = "3f1c0e3e-0a3f-4a1e-9c2e-8b5f1d2a7c44";
const ARTICLE_UUID = "9d2b7a51-6c34-4f80-b1aa-2e7c5d9f0013";

/** A raw driver row: keyed by database column name, values undecoded. */
const AUTHOR_ROW = { id: AUTHOR_UUID, name: "Ada" };

const authorId = encodeGlobalId("authors", { id: AUTHOR_UUID });
const articleId = encodeGlobalId("articles", { id: ARTICLE_UUID });

const TAG_UUID = "5a8e2c1f-7b3d-4e90-a6c4-1d2f3e4a5b6c";
const articleTagId = encodeGlobalId("articleTags", { articleId: ARTICLE_UUID, tagId: TAG_UUID });

/** A node client whose session replays rows keyed by the table being read. */
const nodeSetup = (rows: Record<string, Record<string, unknown>[]> = {}) => {
  const statements: SQLStatement[] = [];

  const execute = vi.fn(async (query: SQLStatement) => {
    statements.push(query);

    const table = Object.keys(rows).find((name) => query.text.includes(`FROM "${name}"`));

    return table ? rows[table] : [];
  });

  const session = {
    execute,
    // A transaction reads through the same replay, so a derived client can be exercised.
    beginTransaction: vi.fn(async () => ({
      execute,
      commit: vi.fn().mockResolvedValue(null),
      rollback: vi.fn().mockResolvedValue(null),
    })),
  } as unknown as Session;

  return { dsql: createClient({ schema: nodeSchema, session }), statements };
};

describe("BaseClient.$findByGlobalId", () => {
  it("reads the row the id names, through that table's model", async () => {
    const { dsql, statements } = nodeSetup({
      authors: [AUTHOR_ROW],
    });

    const record = await dsql.$findByGlobalId(authorId);

    expect(record?.$$key).toBe("authors");
    expect(statements[0]?.text).toContain('FROM "authors"');
    // The raw uuid on the wire, not the wrapped form — the codec unwrapped it on the way in.
    expect(statements[0]?.params?.[0]).toBe(AUTHOR_UUID);
  });

  it("returns the row's own id wrapped", async () => {
    const { dsql } = nodeSetup({ authors: [AUTHOR_ROW] });
    const record = await dsql.$findByGlobalId(authorId);

    expect(record?.$$key === "authors" ? record.id : undefined).toBe(authorId);
  });

  it("returns null when the row is gone", async () => {
    const { dsql } = nodeSetup();

    expect(await dsql.$findByGlobalId(authorId)).toBeNull();
  });

  it("reads every column of the row", async () => {
    const { dsql, statements } = nodeSetup({ authors: [AUTHOR_ROW] });

    await dsql.$findByGlobalId(authorId);

    expect(statements[0]?.text.split(" FROM ")[0]).toBe('SELECT "__t0"."id", "__t0"."name"');
  });

  it("reads a composite key on every field", async () => {
    const { dsql, statements } = nodeSetup({
      article_tags: [{ article_id: ARTICLE_UUID, tag_id: TAG_UUID }],
    });

    const record = await dsql.$findByGlobalId(articleTagId);

    expect(record?.$$key).toBe("articleTags");
    expect(statements[0]?.text).toContain(
      'WHERE "__t0"."article_id" = $1 AND "__t0"."tag_id" = $2 LIMIT'
    );
    expect(statements[0]?.params?.slice(0, 2)).toEqual([ARTICLE_UUID, TAG_UUID]);
  });

  it("reads by a unique column, on a table whose rows emit no ids", async () => {
    const { dsql, statements } = nodeSetup({
      teams: [{ id: AUTHOR_UUID, name: "Core", slug: "core" }],
    });

    const record = await dsql.$findByGlobalId(encodeGlobalId("teams", { slug: "core" }));

    expect(record?.$$key === "teams" ? record.name : null).toBe("Core");
    expect(statements[0]?.text).toContain('WHERE "__t0"."slug" = $1');
  });

  it("refuses an id whose table is not in the schema", async () => {
    const { dsql } = nodeSetup();

    await expect(
      dsql.$findByGlobalId(encodeGlobalId("nowhere", { id: AUTHOR_UUID }))
    ).rejects.toThrow(expect.objectContaining({ code: "unknown_node" }));
  });

  it("refuses an id whose payload is not a unique key", async () => {
    const { dsql } = nodeSetup();

    await expect(dsql.$findByGlobalId(encodeGlobalId("authors", { name: "Ada" }))).rejects.toThrow(
      /carries \(name\), which is not a unique key of it. Its keys are \(id\)/
    );
  });

  it("refuses part of a composite key", async () => {
    const { dsql } = nodeSetup();

    await expect(
      dsql.$findByGlobalId(encodeGlobalId("articleTags", { articleId: ARTICLE_UUID }))
    ).rejects.toThrow(/carries \(articleId\), which is not a unique key of it/);
  });

  it("refuses an id read off a column no relation names", async () => {
    // `articles.authorId` has no relation here, so it reads as an articles id carrying
    // `authorId` — a valid value for the column, but not the address of an article.
    const { dsql } = nodeSetup({ articles: [{ id: ARTICLE_UUID, author_id: AUTHOR_UUID }] });
    const [article] = await dsql.articles.findMany({ select: { authorId: true } });

    expect(article?.authorId).toBe(encodeGlobalId("articles", { authorId: AUTHOR_UUID }));
    await expect(dsql.$findByGlobalId(article?.authorId ?? "")).rejects.toThrow(
      /carries \(authorId\), which is not a unique key of it/
    );
  });

  it("refuses a malformed id", async () => {
    const { dsql } = nodeSetup();

    await expect(dsql.$findByGlobalId(AUTHOR_UUID)).rejects.toThrow(
      expect.objectContaining({ code: "format" })
    );
  });

  it("refuses everything before building a query", async () => {
    const { dsql, statements } = nodeSetup();

    await expect(dsql.$findByGlobalId("nonsense")).rejects.toThrow();
    expect(statements).toHaveLength(0);
  });
});

describe("BaseClient.$listByGlobalId", () => {
  it("returns rows in the order the ids were given", async () => {
    const { dsql } = nodeSetup({
      authors: [AUTHOR_ROW],
      articles: [{ id: ARTICLE_UUID, author_id: AUTHOR_UUID, title: "On ids" }],
    });

    const records = await dsql.$listByGlobalId([articleId, authorId]);

    expect(records.map((record) => record?.$$key)).toEqual(["articles", "authors"]);
  });

  it("keeps the caller's order even when the driver returns another", async () => {
    // Two rows from one table, handed back in the reverse of the order they were asked for.
    // Without the reorder this passes on the driver's order, which nothing guarantees.
    const second = { id: ARTICLE_UUID, name: "Grace" };
    const secondId = encodeGlobalId("authors", { id: ARTICLE_UUID });
    const { dsql } = nodeSetup({ authors: [second, AUTHOR_ROW] });

    const records = await dsql.$listByGlobalId([authorId, secondId]);

    expect(records.map((record) => (record?.$$key === "authors" ? record.name : null))).toEqual([
      "Ada",
      "Grace",
    ]);
  });

  it("issues one query per table, not one per id", async () => {
    const { dsql, statements } = nodeSetup({ authors: [AUTHOR_ROW] });
    const other = encodeGlobalId("authors", { id: ARTICLE_UUID });

    await dsql.$listByGlobalId([authorId, other, authorId]);

    expect(statements).toHaveLength(1);
    expect(statements[0]?.params?.slice(0, 2)).toEqual([AUTHOR_UUID, ARTICLE_UUID]);
  });

  it("returns null for a miss, in place", async () => {
    const { dsql } = nodeSetup({ authors: [AUTHOR_ROW] });
    const missing = encodeGlobalId("authors", { id: ARTICLE_UUID });

    const records = await dsql.$listByGlobalId([missing, authorId, missing]);

    expect(records.map((record) => record?.$$key ?? null)).toEqual([null, "authors", null]);
  });

  it("reads composite and single keys in one batch, matching each back in place", async () => {
    const { dsql, statements } = nodeSetup({
      authors: [AUTHOR_ROW],
      article_tags: [{ article_id: ARTICLE_UUID, tag_id: TAG_UUID }],
    });
    const missingTag = encodeGlobalId("articleTags", {
      articleId: ARTICLE_UUID,
      tagId: AUTHOR_UUID,
    });

    const records = await dsql.$listByGlobalId([articleTagId, missingTag, authorId]);

    expect(records.map((record) => record?.$$key ?? null)).toEqual([
      "articleTags",
      null,
      "authors",
    ]);
    expect(statements.map((statement) => statement.text).join("\n")).toContain(
      'WHERE ("__t0"."article_id" = $1 AND "__t0"."tag_id" = $2 OR ' +
        '"__t0"."article_id" = $3 AND "__t0"."tag_id" = $4)'
    );
  });

  it("queries a table once per key it is asked for under", async () => {
    const { dsql, statements } = nodeSetup({
      teams: [{ id: AUTHOR_UUID, name: "Core", slug: "core" }],
    });

    const records = await dsql.$listByGlobalId([
      encodeGlobalId("teams", { slug: "core" }),
      encodeGlobalId("teams", { id: AUTHOR_UUID.toUpperCase() }),
    ]);

    expect(statements).toHaveLength(2);
    expect(records.map((record) => (record?.$$key === "teams" ? record.slug : null))).toEqual([
      "core",
      "core",
    ]);
  });

  it("returns an empty list for no ids, without querying", async () => {
    const { dsql, statements } = nodeSetup();

    expect(await dsql.$listByGlobalId([])).toEqual([]);
    expect(statements).toHaveLength(0);
  });

  it("throws on the first unusable id rather than dropping it", async () => {
    const { dsql } = nodeSetup();

    await expect(dsql.$listByGlobalId([authorId, "nonsense"])).rejects.toThrow(
      expect.objectContaining({ code: "format" })
    );
  });
});

describe("global id lookups on a derived client", () => {
  it("are available inside a transaction", async () => {
    const { dsql } = nodeSetup({ authors: [AUTHOR_ROW] });

    const record = await dsql.$transaction(async (tx) => tx.$findByGlobalId(authorId));

    expect(record?.$$key).toBe("authors");
  });
});
