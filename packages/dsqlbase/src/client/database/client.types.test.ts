import { describe, expectTypeOf, it, vi } from "vitest";
import type { Schema as CoreSchema, Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { relations, hasMany, table, tenantScope, text, uuid } from "../../schema/index.js";
import type { ClaimsOf } from "./index.js";

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
