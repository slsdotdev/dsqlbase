import { describe, expectTypeOf, it, vi } from "vitest";
import type { Schema as CoreSchema, Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import type { NodeAliasesOf } from "../model/base.js";
import { guid, hasMany, relations, table, text, uuid } from "../../schema/index.js";
import { encodeGlobalId } from "../../schema/utils/global-id.js";

const workspaces = table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const invoices = table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  number: text("number").notNull(),
});

const workspaceRelations = relations(workspaces, {
  invoices: hasMany(invoices, {
    from: [workspaces.columns.id],
    to: [invoices.columns.workspaceId],
  }),
});

const schema = { workspaces, invoices, workspaceRelations };

const session = { execute: vi.fn() } as unknown as Session;

const dsql = createClient({ schema, session });

describe("createClient", () => {
  it("shows every table, and the raw-SQL methods", () => {
    expectTypeOf(dsql).toHaveProperty("workspaces");
    expectTypeOf(dsql).toHaveProperty("invoices");
    expectTypeOf(dsql).toHaveProperty("$query");
    expectTypeOf(dsql).toHaveProperty("$execute");
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

// Its rows emit no ids, but a hand-built one over its key resolves.
const teams = table("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

// Addressed by both fields of its key.
const memberships = table("memberships", {
  authorId: guid("author_id"),
  teamId: uuid("team_id"),
});

// Not chained: `primaryKey()` returns the constraint, not the table.
memberships.primaryKey((c) => [c.authorId, c.teamId]);

const nodeSchema = { authors, articles, teams, memberships };
type NodeSchema = CoreSchema<typeof nodeSchema>;

// Its own session: these assertions really call through, so it has to answer like a driver.
const nodeSession = { execute: vi.fn(async () => []) } as unknown as Session;

const nodes = createClient({ schema: nodeSchema, session: nodeSession });

const someAuthorId = encodeGlobalId("authors", { id: "3f1c0e3e-0a3f-4a1e-9c2e-8b5f1d2a7c44" });

describe("NodeAliasesOf", () => {
  it("is every table, since keys beyond the column flags are invisible to the types", () => {
    expectTypeOf<NodeAliasesOf<NodeSchema>>().toEqualTypeOf<
      "authors" | "articles" | "teams" | "memberships"
    >();
  });
});

describe("$findByGlobalId", () => {
  it("returns a union over every node, discriminated by $$meta.key", async () => {
    const record = await nodes.$findByGlobalId(someAuthorId);

    expectTypeOf(record).toExtend<{
      $$key: "authors" | "articles" | "teams" | "memberships";
    } | null>();

    if (record?.$$key === "authors") {
      expectTypeOf(record.name).toEqualTypeOf<string>();
    }

    if (record?.$$key === "articles") {
      expectTypeOf(record.title).toEqualTypeOf<string>();
    }

    if (record?.$$key === "memberships") {
      expectTypeOf(record.teamId).toEqualTypeOf<string | null>();
    }
  });

  it("takes only an id", () => {
    expectTypeOf(() => {
      // @ts-expect-error the lookup reads the whole row; a narrower read is the model's findOne.
      void nodes.$findByGlobalId({ id: someAuthorId });
      // @ts-expect-error there is no `on` map.
      void nodes.$findByGlobalId(someAuthorId, { on: { authors: true } });
    }).toBeFunction();
  });
});

describe("$listByGlobalId", () => {
  it("returns one entry per id, each nullable", async () => {
    const records = await nodes.$listByGlobalId([someAuthorId]);

    expectTypeOf(records).toExtend<unknown[]>();
    expectTypeOf(records[0]).toExtend<
      { $$key: "authors" | "articles" | "teams" | "memberships" } | null | undefined
    >();
  });
});

describe("$transaction batching", () => {
  it("accepts a counted page — two statements — beside single ones, each result typed", () => {
    // Never invoked: the session here cannot begin a transaction.
    const batch = () =>
      dsql.$transaction([
        dsql.workspaces.paginate({ select: { name: true }, count: true }),
        dsql.workspaces.count(),
      ]);

    const results = expectTypeOf(batch).returns.resolves;

    results.toHaveProperty(0).toHaveProperty("totalCount").toEqualTypeOf<number>();
    results.toHaveProperty(0).toHaveProperty("items").items.toHaveProperty("name").toBeString();
    results.toHaveProperty(1).toEqualTypeOf<number>();
  });
});
