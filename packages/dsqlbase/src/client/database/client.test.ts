import { describe, expect, it, vi } from "vitest";
import { sql, TenancyError, type Session, type SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { ModelClient } from "../model/client.js";
import { relations, hasMany, table, tenantScope, text, uuid } from "../../schema/index.js";

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
