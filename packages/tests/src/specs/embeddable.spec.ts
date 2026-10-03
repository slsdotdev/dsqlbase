import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SQLStatement } from "@dsqlbase/core";
import { Session } from "@dsqlbase/core/runtime";
import { createMigrationRunner, MigrationRunner } from "@dsqlbase/migration";
import { embedded, numeric, table, text, uuid } from "dsqlbase/schema";
import { encodeGlobalId, isGlobalId } from "dsqlbase";
import { withSeededClient } from "../fixures/seeded-client";

/**
 * Column groups against a real database: `invoices` embeds `money` twice (`netValue`, and
 * `discount` with a group default), a nullable `address` with a nested `geo` (`billing`), and a
 * `review` whose `by` member is a `guid()` pointing at authors.
 */
describe("column groups", () => {
  const { getClient, getData } = withSeededClient();

  const createInvoice = (data: Record<string, unknown> = {}) =>
    getClient().invoices.create({
      data: { number: "INV-1", netValue: { amount: 100 }, ...data } as never,
      return: { id: true },
    });

  describe("storage", () => {
    it("creates one plain column per member, required members NOT NULL", async () => {
      const columns = await getClient().$execute<{ column_name: string; is_nullable: string }>({
        text: `SELECT column_name, is_nullable FROM information_schema.columns
               WHERE table_name = 'invoices' ORDER BY ordinal_position`,
        params: [],
      });

      expect(columns.map((column) => [column.column_name, column.is_nullable])).toEqual([
        ["id", "NO"],
        ["number", "NO"],
        ["net_value_amount", "NO"],
        ["net_value_currency", "NO"],
        ["discount_amount", "NO"],
        ["discount_currency", "NO"],
        ["billing_city", "YES"],
        ["billing_zip", "YES"],
        ["billing_geo_lat", "YES"],
        ["billing_geo_lng", "YES"],
        ["review_by", "YES"],
        ["review_at", "YES"],
      ]);
    });

    it("rejects a NULL required member written around the client", async () => {
      await expect(
        getClient().$execute({
          text: `INSERT INTO invoices (number, net_value_amount) VALUES ('raw', NULL)`,
          params: [],
        })
      ).rejects.toThrow(/null value in column "net_value_amount"/);
    });

    it("uses an index on a member", async () => {
      await getClient().$execute({ text: `SET enable_seqscan = off`, params: [] });
      const plan = await getClient().$execute<{ "QUERY PLAN": string }>({
        text: `EXPLAIN SELECT id FROM invoices WHERE net_value_amount > 10`,
        params: [],
      });
      await getClient().$execute({ text: `SET enable_seqscan = on`, params: [] });

      expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "invoices_net_value_amount_idx"
      );
    });
  });

  describe("reading and writing", () => {
    it("round-trips a group, filling omitted members from their defaults", async () => {
      const created = await createInvoice({ billing: { city: "Cluj", geo: { lat: 46.77 } } });

      const invoice = await getClient().invoices.findOne({ where: { id: created?.id ?? "" } });

      expect(invoice?.netValue).toEqual({ amount: 100, currency: "EUR" });
      expect(invoice?.discount).toEqual({ amount: 0, currency: "EUR" });
      expect(invoice?.billing).toEqual({ city: "Cluj", zip: null, geo: { lat: 46.77, lng: null } });
    });

    it("reads a group whose members are all NULL as null, nested groups too", async () => {
      const absent = await createInvoice();
      const partial = await createInvoice({ billing: { zip: "400000" } });

      const [first, second] = await getClient().invoices.findMany({
        where: { id: { in: [absent?.id ?? "", partial?.id ?? ""] } },
        select: { number: true, billing: true },
        orderBy: { billing: { zip: "asc" } },
      });

      expect(first?.billing).toEqual({ city: null, zip: "400000", geo: null });
      expect(second?.billing).toBeNull();
    });

    it("tells a present group from an absent one through a partial select", async () => {
      await createInvoice({ billing: { zip: "400000" } });

      const [invoice] = await getClient().invoices.findMany({
        select: { billing: { city: true } },
      });

      // `city` is NULL, but `zip` is set: the group is present.
      expect(invoice?.billing).toEqual({ city: null });
    });

    it("updates only the members named, and runs a member's $onUpdate", async () => {
      const created = await createInvoice({ billing: { city: "Cluj", zip: "400000" } });
      const id = created?.id ?? "";

      await getClient().invoices.update({
        where: { id },
        set: { netValue: { amount: 120 }, billing: { geo: { lng: 23.6 } } },
      });

      const invoice = await getClient().invoices.findOne({ where: { id } });

      expect(invoice?.netValue).toEqual({ amount: 120, currency: "EUR" });
      expect(invoice?.billing).toEqual({
        city: "Cluj",
        zip: "400000",
        geo: { lat: null, lng: 23.6 },
      });
      expect(invoice?.review).toEqual({ by: null, at: "updated" });
    });

    it("empties a nullable group with null", async () => {
      const created = await createInvoice({
        billing: { city: "Cluj", zip: "400000", geo: { lng: 23.6 } },
      });
      const id = created?.id ?? "";

      await getClient().invoices.update({ where: { id }, set: { billing: null } });

      expect((await getClient().invoices.findOne({ where: { id } }))?.billing).toBeNull();
    });

    it("carries global ids through a guid() member", async () => {
      const author = getData().authors[0];
      const authorId = encodeGlobalId("authors", { id: author?.id ?? "" });

      await createInvoice({ review: { by: authorId } });
      await createInvoice({ number: "INV-2" });

      const found = await getClient().invoices.findMany({
        where: { review: { where: { by: authorId } } },
        select: { number: true, review: { by: true } },
      });

      expect(found).toHaveLength(1);
      expect(isGlobalId(found[0]?.review?.by)).toBe(true);
      expect(found[0]?.review?.by).toBe(authorId);
    });
  });

  describe("filtering, ordering and paging", () => {
    beforeEach(async () => {
      for (const [number, amount, city] of [
        ["A", 50, "Cluj"],
        ["B", 150, null],
        ["C", 300, "Iasi"],
        ["D", 150, "Cluj"],
      ] as const) {
        await createInvoice({ number, netValue: { amount }, billing: city ? { city } : undefined });
      }
    });

    const numbers = (rows: { number: string }[]) => rows.map((row) => row.number);

    it("filters by members through the nested where", async () => {
      const rows = await getClient().invoices.findMany({
        where: {
          netValue: { where: { amount: { gte: 100 }, currency: "EUR" } },
          billing: { where: { city: "Cluj" } },
        },
        select: { number: true },
      });

      expect(numbers(rows)).toEqual(["D"]);
    });

    it("filters by presence with exists", async () => {
      const absent = await getClient().invoices.findMany({
        where: { billing: { exists: false } },
        select: { number: true },
      });
      const present = await getClient().invoices.findMany({
        where: { billing: { exists: true } },
        select: { number: true },
        orderBy: { number: "asc" },
      });

      expect(numbers(absent)).toEqual(["B"]);
      expect(numbers(present)).toEqual(["A", "C", "D"]);
    });

    it("orders by a member, and pages through ties on it", async () => {
      const ordered = await getClient().invoices.findMany({
        select: { number: true },
        orderBy: { netValue: { amount: "desc" }, number: "asc" },
      });
      expect(numbers(ordered)).toEqual(["C", "B", "D", "A"]);

      const seen: string[] = [];
      let after: string | undefined;

      do {
        const page = await getClient().invoices.paginate({
          select: { number: true },
          orderBy: { netValue: { amount: "desc" } },
          limit: 1,
          after,
        });

        seen.push(...numbers(page.items));
        after = page.hasNextPage ? (page.endCursor ?? undefined) : undefined;
      } while (after);

      expect(seen).toHaveLength(4);
      expect(new Set(seen)).toEqual(new Set(["A", "B", "C", "D"]));
      expect(seen[0]).toBe("C");
      expect(seen[3]).toBe("A");
    });
  });
});

class PGliteSession implements Session {
  constructor(private readonly pg: PGlite) {}

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this.pg.query(query.text, [...query.params]);
    return result.rows as T[];
  }
}

describe("migrating column groups", () => {
  let pg: PGlite;
  let runner: MigrationRunner;

  beforeEach(() => {
    pg = new PGlite("memory://");
    runner = createMigrationRunner(new PGliteSession(pg));
  });

  afterEach(async () => {
    await pg.close();
  });

  const RUN_OPTS = { asyncIndexes: false, ifExists: true, allow: { destructive: true } };

  const money = embedded({
    amount: numeric("amount").notNull(),
    label: text("label").default("-"),
  });
  const ledger = table("ledger", {
    id: uuid("id").primaryKey(),
    total: money.column("total"),
  });
  ledger.index("ledger_total_amount_idx").columns((c) => [c.total.amount]);

  it("plans nothing on a second run", async () => {
    await runner.run([ledger.toJSON()], RUN_OPTS);

    const plan = await runner.plan([ledger.toJSON()], RUN_OPTS);

    expect(plan.errors).toEqual([]);
    expect(plan.operations).toEqual([]);
  });

  it("adds a nullable member as a column", async () => {
    await runner.run([ledger.toJSON()], RUN_OPTS);

    const wider = embedded({
      amount: numeric("amount").notNull(),
      label: text("label").default("-"),
      note: text("note"),
    });
    const v2 = table("ledger", {
      id: uuid("id").primaryKey(),
      total: wider.column("total"),
    });
    v2.index("ledger_total_amount_idx").columns((c) => [c.total.amount]);

    const result = await runner.run([v2.toJSON()], RUN_OPTS);

    expect(result.progress.every((step) => step.status === "completed")).toBe(true);
    expect((await runner.plan([v2.toJSON()], RUN_OPTS)).operations).toEqual([]);
  });

  // A shape evolves as its members' columns do, in every table that embeds it.
  describe("evolving a shape", () => {
    const shape = (members: Parameters<typeof embedded>[0]) => {
      const t = table("ledger", {
        id: uuid("id").primaryKey(),
        total: embedded(members).column("total"),
      });
      return t.toJSON();
    };
    const rows = async (text: string) => (await pg.query(text)).rows;

    beforeEach(async () => {
      await runner.run(
        [shape({ amount: numeric("amount").notNull(), label: text("label") })],
        RUN_OPTS
      );
      await pg.query(`INSERT INTO ledger (id, total_amount) VALUES (gen_random_uuid(), 5)`);
    });

    it("adds a required member with a default: existing rows get the default", async () => {
      const v2 = shape({
        amount: numeric("amount").notNull(),
        label: text("label"),
        currency: text("currency").notNull().default("EUR"),
      });

      const result = await runner.run([v2], RUN_OPTS);

      expect(result.rows.map((row) => row.action)).toEqual([
        "ADD",
        "ADD",
        "BACKFILL",
        "ADD",
        "VALIDATE",
      ]);
      expect(await rows(`SELECT total_currency FROM ledger`)).toEqual([{ total_currency: "EUR" }]);
      expect((await runner.plan([v2], RUN_OPTS)).rows).toEqual([]);
    });

    it("refuses a required member without a default", async () => {
      const plan = await runner.plan(
        [
          shape({
            amount: numeric("amount").notNull(),
            label: text("label"),
            currency: text("currency").notNull(),
          }),
        ],
        RUN_OPTS
      );

      expect(plan.errors.map((error) => error.code)).toEqual(["NOT_NULL_NEEDS_DEFAULT"]);
    });

    it("renames a member, keeping its data", async () => {
      await pg.query(`UPDATE ledger SET total_label = 'kept'`);
      const v2 = shape({
        amount: numeric("amount").notNull(),
        title: text("title").renamedFrom("label"),
      });

      const result = await runner.run([v2], { asyncIndexes: false, ifExists: true });

      expect(result.rows.map((row) => row.sql)).toEqual([
        `ALTER TABLE "ledger" RENAME COLUMN "total_label" TO "total_title"`,
      ]);
      expect(await rows(`SELECT total_title FROM ledger`)).toEqual([{ total_title: "kept" }]);
    });

    it("drops a member only when destructive steps are allowed", async () => {
      const v2 = shape({ amount: numeric("amount").notNull() });

      await expect(runner.run([v2], { asyncIndexes: false, ifExists: true })).rejects.toThrow(
        /DESTRUCTIVE_NOT_ALLOWED.*total_label/
      );
      const result = await runner.run([v2], RUN_OPTS);

      expect(result.rows.map((row) => [row.action, row.target])).toEqual([["DROP", "total_label"]]);
    });

    it("changes a member default, and makes a member nullable", async () => {
      const v2 = shape({ amount: numeric("amount"), label: text("label").default("none") });

      const result = await runner.run([v2], RUN_OPTS);

      expect(result.rows.map((row) => row.sql)).toEqual([
        `ALTER TABLE "ledger" ALTER COLUMN "total_amount" DROP NOT NULL`,
        `ALTER TABLE "ledger" ALTER COLUMN "total_label" SET DEFAULT 'none'`,
      ]);
      expect((await runner.plan([v2], RUN_OPTS)).rows).toEqual([]);
    });
  });
});
