import { describe, expectTypeOf, it, vi } from "vitest";
import type { Schema as CoreSchema, Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { guid, relations, hasMany, table, tenantScope, text, uuid } from "../../schema/index.js";
import type { ClaimsOf } from "./index.js";
import type { NodeAliasesOf } from "../model/base.js";
import { encodeGlobalId } from "../../schema/utils/global-id.js";

const ws = tenantScope({
  workspaceId: uuid("workspace_id").notNull(),
});

const region = tenantScope({
  workspaceId: uuid("workspace_id").notNull(),
  regionId: uuid("region_id").notNull(),
});

const workspaces = table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const invoices = ws.table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
});

const reports = region.table("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
});

const workspaceRelations = relations(workspaces, {
  invoices: hasMany(invoices, {
    from: [workspaces.columns.id],
    to: [invoices.columns.workspaceId],
  }),
});

const schema = { workspaces, invoices, reports, workspaceRelations };
type Schema = typeof schema;

const session = { execute: vi.fn() } as unknown as Session;

const dsql = createClient({ schema, session });
const unscoped = createClient({ schema, session, tenancy: { enforce: false } });
const scoped = dsql.$identityClaims({ workspaceId: "w1", regionId: "r1" });
const partial = dsql.$identityClaims({ workspaceId: "w1" });

describe("ClaimsOf", () => {
  // An intersection of one object per table rather than a flat one, so it is read property by
  // property — `toEqualTypeOf` is invariant and would reject the shape for that alone.
  it("gathers every claim in the schema into one object", () => {
    const claims = expectTypeOf<ClaimsOf<CoreSchema<Schema>>>();

    claims.toHaveProperty("workspaceId").toEqualTypeOf<string>();
    claims.toHaveProperty("regionId").toEqualTypeOf<string>();
  });

  it("carries no key for a column outside every scope", () => {
    expectTypeOf<ClaimsOf<CoreSchema<Schema>>>().not.toHaveProperty("name");
  });
});

describe("createClient with tenancy enforced", () => {
  it("keeps the global tables", () => {
    expectTypeOf(dsql.workspaces).toHaveProperty("findMany");
    expectTypeOf(dsql.workspaces.findMany).toBeFunction();
  });

  it("hides every tenant table, because reaching one would throw", () => {
    expectTypeOf(dsql).not.toHaveProperty("invoices");
    expectTypeOf(dsql).not.toHaveProperty("reports");
  });

  it("keeps the raw-SQL methods", () => {
    expectTypeOf(dsql).toHaveProperty("$query");
    expectTypeOf(dsql).toHaveProperty("$execute");
  });
});

describe("createClient with tenancy: { enforce: false }", () => {
  it("shows tenant tables alongside global ones", () => {
    expectTypeOf(unscoped).toHaveProperty("invoices");
    expectTypeOf(unscoped).toHaveProperty("reports");
    expectTypeOf(unscoped).toHaveProperty("workspaces");
  });
});

describe("$identityClaims", () => {
  it("shows the tenant tables its claims cover", () => {
    expectTypeOf(scoped).toHaveProperty("invoices");
    expectTypeOf(scoped).toHaveProperty("reports");
    expectTypeOf(scoped).toHaveProperty("workspaces");
  });

  it("hides a table whose claims it holds only some of", () => {
    expectTypeOf(partial).toHaveProperty("invoices");
    // `reports` needs regionId too, which this identity does not carry.
    expectTypeOf(partial).not.toHaveProperty("reports");
  });

  it("returns a client with no raw SQL that cannot be re-scoped", () => {
    expectTypeOf(scoped).not.toHaveProperty("$query");
    expectTypeOf(scoped).not.toHaveProperty("$execute");
    expectTypeOf(scoped).not.toHaveProperty("$identityClaims");
  });

  it("still allows transactions, which inherit the scope", () => {
    expectTypeOf(scoped).toHaveProperty("$transaction");
  });

  it("rejects a misspelled claim in a literal", () => {
    // @ts-expect-error `workspacesId` is not a claim this schema declares.
    dsql.$identityClaims({ workspacesId: "w1" });
  });

  it("accepts an identity carrying keys the schema does not declare", () => {
    const token = { workspaceId: "w1", sub: "user-1", exp: 123 };

    expectTypeOf(dsql.$identityClaims({ ...token })).toHaveProperty("invoices");
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
  authorId: guid("author_id", "authors").notNull(),
  title: text("title").notNull(),
});

// Not a node: a uuid primary key is just a uuid primary key.
const teams = table("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

// Not a node either: `guid()` can only name one column, so a composite key has no id.
const memberships = table("memberships", {
  authorId: guid("author_id", "authors"),
  teamId: uuid("team_id"),
}).primaryKey((c) => [c.authorId, c.teamId]);

const nodeSchema = { authors, articles, teams, memberships };
type NodeSchema = CoreSchema<typeof nodeSchema>;

// Its own session: these assertions really call through, so it has to answer like a driver.
const nodeSession = { execute: vi.fn(async () => []) } as unknown as Session;

const nodes = createClient({ schema: nodeSchema, session: nodeSession });

const someAuthorId = encodeGlobalId("authors", { id: "3f1c0e3e-0a3f-4a1e-9c2e-8b5f1d2a7c44" });

describe("NodeAliasesOf", () => {
  it("is every table whose primary key is a single guid column", () => {
    expectTypeOf<NodeAliasesOf<NodeSchema>>().toEqualTypeOf<"authors" | "articles">();
  });
});

describe("$findByGlobalId", () => {
  it("returns a union over every node, discriminated by $$meta.key", async () => {
    const record = await nodes.$findByGlobalId({ id: someAuthorId });

    expectTypeOf(record).toExtend<{ $$key: "authors" | "articles" } | null>();

    if (record?.$$key === "authors") {
      expectTypeOf(record.name).toEqualTypeOf<string>();
    }

    if (record?.$$key === "articles") {
      expectTypeOf(record.title).toEqualTypeOf<string>();
    }
  });

  it("applies a per-alias select to that branch alone", async () => {
    const record = await nodes.$findByGlobalId({
      id: someAuthorId,
      on: { authors: { select: { name: true } } },
    });

    if (record?.$$key === "authors") {
      expectTypeOf(record.name).toEqualTypeOf<string>();
      // Deselected, so it is gone from this branch.
      expectTypeOf(record).not.toHaveProperty("id");
    }

    if (record?.$$key === "articles") {
      // Untouched by the other branch's select.
      expectTypeOf(record.title).toEqualTypeOf<string>();
      expectTypeOf(record.authorId).toEqualTypeOf<string>();
    }
  });

  it("drops a member the `on` map excluded", async () => {
    const record = await nodes.$findByGlobalId({ id: someAuthorId, on: { articles: false } });

    expectTypeOf(record).toExtend<{ $$key: "authors" } | null>();
  });

  // The rejected calls sit in arrows that are never invoked: this file also runs, and a real
  // call would reach the normalizer and reject with nothing awaiting it.
  it("does not accept a table that is not a node", () => {
    expectTypeOf(() => {
      // @ts-expect-error `teams` has a uuid key, so no id can name it.
      void nodes.$findByGlobalId({ id: someAuthorId, on: { teams: true } });
      // @ts-expect-error a composite key cannot be a node.
      void nodes.$findByGlobalId({ id: someAuthorId, on: { memberships: true } });
    }).toBeFunction();
  });

  it("does not accept a field the branch does not have", () => {
    expectTypeOf(() => {
      void nodes.$findByGlobalId({
        id: someAuthorId,
        // @ts-expect-error `title` is on articles, not authors.
        on: { authors: { select: { title: true } } },
      });
    }).toBeFunction();
  });
});

describe("$listByGlobalId", () => {
  it("returns one entry per id, each nullable", async () => {
    const records = await nodes.$listByGlobalId({ ids: [someAuthorId] });

    expectTypeOf(records).toExtend<unknown[]>();
    expectTypeOf(records[0]).toExtend<{ $$key: "authors" | "articles" } | null | undefined>();
  });

  it("keeps the node key in the result even when select leaves it out", async () => {
    const records = await nodes.$listByGlobalId({
      ids: [someAuthorId],
      on: { authors: { select: { name: true } } },
    });

    const record = records[0];

    if (record?.$$key === "authors") {
      expectTypeOf(record.name).toEqualTypeOf<string>();
      // Always projected — it is what puts a row back against the id that asked for it.
      expectTypeOf(record.id).toEqualTypeOf<string>();
    }
  });
});

describe("global id lookups and client derivation", () => {
  it("survive scoping, unlike raw SQL", () => {
    const identity = nodes.$identityClaims({});

    expectTypeOf(identity).toHaveProperty("$findByGlobalId");
    expectTypeOf(identity).toHaveProperty("$listByGlobalId");
    expectTypeOf(identity).not.toHaveProperty("$query");
  });
});
