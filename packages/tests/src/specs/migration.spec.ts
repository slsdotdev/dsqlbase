import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { sql, SQLStatement } from "@dsqlbase/core";
import { Session } from "@dsqlbase/core/runtime";
import { bigint, domain, int, sequence, table, text, uuid, varchar } from "dsqlbase/schema";
import {
  createMigrationRunner,
  formatPlan,
  introspect,
  MigrationRunner,
  getSerializedSchemaObjects,
  type SerializedSchema,
} from "@dsqlbase/migration";
import { schema } from "../db/schema";

class PGliteSession implements Session {
  constructor(private readonly pg: PGlite) {}

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this.pg.query(query.text, [...query.params]);
    return result.rows as T[];
  }
}

// PGlite cannot run DSQL ASYNC indexes; destructive steps are allowed so tests can drop.
const RUN_OPTS = { asyncIndexes: false, ifExists: true, allow: { destructive: true } };

describe("schema migrations (e2e via PGlite)", () => {
  let pg: PGlite;
  let runner: MigrationRunner;

  beforeEach(() => {
    pg = new PGlite("memory://");
    runner = createMigrationRunner(new PGliteSession(pg));
  });

  afterEach(async () => {
    await pg.close();
  });

  it("bootstraps an empty database from a schema definition", async () => {
    const widgets = table("widgets", {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
    });

    const result = await runner.run([widgets.toJSON()], RUN_OPTS);

    expect(result.progress.every((p) => p.status === "completed")).toBe(true);

    const remote = await introspect(new PGliteSession(pg));
    expect(remote.find((o) => o.kind === "TABLE" && o.name === "widgets")).toBeDefined();
  });

  it("re-running the same schema is a no-op", async () => {
    const widgets = table("widgets", {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
    });

    await runner.run([widgets.toJSON()], RUN_OPTS);

    const plan = await runner.plan([widgets.toJSON()], RUN_OPTS);
    expect(plan.errors).toEqual([]);
    expect(plan.operations).toEqual([]);
  });

  // The whole e2e fixture: every column kind, default, domain, sequence, index and constraint the
  // builders produce. A second plan must be empty, or every deploy re-plans (and refuses) work
  // that is already done.
  it("plans nothing on a second run of the full fixture schema", async () => {
    const definitions = getSerializedSchemaObjects(Object.values(schema));

    await runner.run(definitions, RUN_OPTS);
    const plan = await runner.plan(definitions, RUN_OPTS);

    expect(plan.errors.map((e) => `${e.code} ${e.subject ?? e.object.name}`)).toEqual([]);
    expect(plan.operations.map((op) => `${op.type} ${op.object.kind} ${op.object.name}`)).toEqual(
      []
    );
  });

  it("emits CREATE INDEX for a new unique index", async () => {
    const widgets = table("widgets", {
      id: uuid("id").primaryKey(),
      slug: text("slug").notNull(),
    });
    widgets.index("widgets_slug_idx", { unique: true }).columns((c) => [c.slug]);

    const statements = await runner.dryRun([widgets.toJSON()], RUN_OPTS);
    const sqlText = statements.map((s) => s.text);

    expect(sqlText[0]).toMatch(/CREATE TABLE/);
    expect(sqlText[1]).toMatch(/CREATE UNIQUE INDEX/);

    const result = await runner.run([widgets.toJSON()], RUN_OPTS);
    expect(result.progress.every((p) => p.status === "completed")).toBe(true);
  });

  it("runs a multi-step change in order and reports every step", async () => {
    const v1 = table("widgets", {
      id: uuid("id").primaryKey(),
      name: text("name"),
    });
    v1.index("widgets_name_idx").columns((c) => [c.name]);
    await runner.run([v1.toJSON()], RUN_OPTS);

    // Adds a unique column — the column, then its UNIQUE as an index and its promotion — and
    // drops the index on `name`.
    const v2 = table("widgets", {
      id: uuid("id").primaryKey(),
      name: text("name"),
      slug: text("slug").unique(),
    });

    const result = await runner.run([v2.toJSON()], RUN_OPTS);

    expect(result.rows.map((row) => [row.action, row.changeStep, row.target, row.status])).toEqual([
      ["ADD", "1/1", "slug", "completed"],
      ["DROP", "1/1", "widgets_name_idx", "completed"],
      ["CREATE", "1/2", "widgets_slug_key_idx", "completed"],
      ["ADD", "2/2", "widgets_slug_key", "completed"],
    ]);
    expect(formatPlan(result)).toContain("Status");

    const again = await runner.plan([v2.toJSON()], RUN_OPTS);
    expect(again.rows).toEqual([]);
    expect(formatPlan(again)).toBe("Nothing to do: the database matches the definition.");
  });

  it("creates a domain and a sequence alongside a table in dependency order", async () => {
    const status = domain("status").$type<"open" | "closed">();
    const counter = sequence("counter").startWith(1);

    const tickets = table("tickets", {
      id: uuid("id").primaryKey(),
      state: status.column("state").notNull(),
      seq: int("seq").notNull(),
    });

    const definitions: SerializedSchema = [status.toJSON(), counter.toJSON(), tickets.toJSON()];
    const result = await runner.run(definitions, RUN_OPTS);

    const order = result.progress.map((p) => p.sql.split(" ").slice(0, 2).join(" "));

    expect(result.progress.every((p) => p.status === "completed")).toBe(true);
    expect(order.indexOf("CREATE DOMAIN")).toBeLessThan(order.indexOf("CREATE TABLE"));
  });

  describe("constraints on an existing table", () => {
    const orders = (constraints: "none" | "check" | "unique-qty" | "unique-qty-sku") => {
      const t = table("orders", {
        id: uuid("id").primaryKey(),
        qty: int("qty"),
        sku: text("sku"),
      });
      if (constraints === "check") t.check((c) => sql`${c.qty} > 0`, "orders_qty_positive");
      if (constraints === "unique-qty") t.unique((c) => [c.qty]);
      if (constraints === "unique-qty-sku") {
        t.unique((c) => [c.qty, c.sku]);
      }
      return t.toJSON();
    };

    const insert = (qty: number) =>
      pg.query(`INSERT INTO orders (id, qty) VALUES (gen_random_uuid(), $1)`, [qty]);

    it("adds a CHECK NOT VALID and validates it", async () => {
      await runner.run([orders("none")], RUN_OPTS);
      await insert(3);

      const result = await runner.run([orders("check")], RUN_OPTS);

      expect(result.rows.map((row) => [row.action, row.status])).toEqual([
        ["ADD", "completed"],
        ["VALIDATE", "completed"],
      ]);
      await expect(insert(0)).rejects.toThrow(/orders_qty_positive/);
      expect((await runner.plan([orders("check")], RUN_OPTS)).rows).toEqual([]);
    });

    it("keeps a CHECK that existing rows violate, NOT VALID, and validates it once fixed", async () => {
      await runner.run([orders("none")], RUN_OPTS);
      await insert(-1);

      const failed = await runner.run([orders("check")], RUN_OPTS);

      expect(failed.rows.map((row) => [row.action, row.status])).toEqual([
        ["ADD", "completed"],
        ["VALIDATE", "failed"],
      ]);
      expect(failed.rows[1]?.error).toMatch(/orders_qty_positive/);
      // Enforced on new writes even though not valid.
      await expect(insert(0)).rejects.toThrow(/orders_qty_positive/);

      const pending = await runner.plan([orders("check")], RUN_OPTS);
      expect(pending.rows.map((row) => row.action)).toEqual(["VALIDATE"]);

      await pg.query(`UPDATE orders SET qty = 1 WHERE qty < 1`);
      const fixed = await runner.run([orders("check")], RUN_OPTS);

      expect(fixed.rows.map((row) => row.status)).toEqual(["completed"]);
      expect((await runner.plan([orders("check")], RUN_OPTS)).rows).toEqual([]);
    });

    it("drops a removed CHECK", async () => {
      await runner.run([orders("check")], RUN_OPTS);

      const result = await runner.run([orders("none")], RUN_OPTS);

      expect(result.rows.map((row) => [row.action, row.targetKind, row.risk])).toEqual([
        ["DROP", "CONSTRAINT", "lossy"],
      ]);
      await insert(0);
    });

    it("rebuilds a UNIQUE constraint whose columns changed", async () => {
      await runner.run([orders("unique-qty")], RUN_OPTS);

      const result = await runner.run([orders("unique-qty-sku")], RUN_OPTS);

      expect(result.rows.map((row) => [row.action, row.changeStep, row.status])).toEqual([
        ["DROP", "1/3", "completed"],
        ["CREATE", "2/3", "completed"],
        ["ADD", "3/3", "completed"],
      ]);
      expect((await runner.plan([orders("unique-qty-sku")], RUN_OPTS)).rows).toEqual([]);
    });

    it("rebuilds a changed index", async () => {
      const v1 = table("orders", {
        id: uuid("id").primaryKey(),
        qty: int("qty"),
        sku: text("sku"),
      });
      v1.index("orders_lookup_idx").columns((c) => [c.qty]);
      const v2 = table("orders", {
        id: uuid("id").primaryKey(),
        qty: int("qty"),
        sku: text("sku"),
      });
      v2.index("orders_lookup_idx").columns((c) => [c.qty, c.sku]);

      await runner.run([v1.toJSON()], RUN_OPTS);
      const result = await runner.run([v2.toJSON()], RUN_OPTS);

      expect(result.rows.map((row) => [row.action, row.risk, row.status])).toEqual([
        ["DROP", "lossy", "completed"],
        ["CREATE", "safe", "completed"],
      ]);
      expect((await runner.plan([v2.toJSON()], RUN_OPTS)).rows).toEqual([]);
    });
  });

  describe("columns on an existing table", () => {
    const rows = async (text: string) => (await pg.query(text)).rows;
    const NO_DESTRUCTIVE = { asyncIndexes: false, ifExists: true };

    it("adds a column with a default: new rows get it, existing rows stay NULL", async () => {
      const v1 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
      });
      const v2 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
        status: text("status").default("new"),
      });
      await runner.run([v1.toJSON()], RUN_OPTS);
      await pg.query(`INSERT INTO items (name) VALUES ('old')`);

      const result = await runner.run([v2.toJSON()], RUN_OPTS);
      await pg.query(`INSERT INTO items (name) VALUES ('fresh')`);

      expect(result.rows.map((row) => row.action)).toEqual(["ADD", "ADD"]);
      expect(await rows(`SELECT name, status FROM items ORDER BY name`)).toEqual([
        { name: "fresh", status: "new" },
        { name: "old", status: null },
      ]);
      expect((await runner.plan([v2.toJSON()], RUN_OPTS)).rows).toEqual([]);
    });

    it("adds a NOT NULL column with a default: backfills existing rows, enforces NOT NULL", async () => {
      const v1 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
      });
      const v2 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
        status: text("status").notNull().default("new"),
      });
      await runner.run([v1.toJSON()], RUN_OPTS);
      for (let i = 0; i < 3; i++) await pg.query(`INSERT INTO items (name) VALUES ('old')`);

      const result = await runner.run([v2.toJSON()], RUN_OPTS);

      expect(result.rows.map((row) => [row.action, row.status])).toEqual([
        ["ADD", "completed"],
        ["ADD", "completed"],
        ["BACKFILL", "completed"],
        ["ADD", "completed"],
        ["VALIDATE", "completed"],
      ]);
      expect(await rows(`SELECT DISTINCT status FROM items`)).toEqual([{ status: "new" }]);
      await expect(pg.query(`INSERT INTO items (name, status) VALUES ('x', NULL)`)).rejects.toThrow(
        /items_status_not_null/
      );
      expect((await runner.plan([v2.toJSON()], RUN_OPTS)).rows).toEqual([]);
    });

    it("makes a column NOT NULL: validation fails while a NULL is left, passes once fixed", async () => {
      const v1 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
      });
      const v2 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name").notNull(),
      });
      await runner.run([v1.toJSON()], RUN_OPTS);
      await pg.query(`INSERT INTO items (name) VALUES (NULL)`);

      const failed = await runner.run([v2.toJSON()], RUN_OPTS);
      expect(failed.rows.map((row) => [row.action, row.status])).toEqual([
        ["ADD", "completed"],
        ["VALIDATE", "failed"],
      ]);

      await pg.query(`UPDATE items SET name = 'named'`);
      const fixed = await runner.run([v2.toJSON()], RUN_OPTS);

      expect(fixed.rows.map((row) => [row.action, row.status])).toEqual([
        ["VALIDATE", "completed"],
      ]);
      expect((await runner.plan([v2.toJSON()], RUN_OPTS)).rows).toEqual([]);
    });

    it("drops a NOT NULL, whether CREATE TABLE or a CHECK made it", async () => {
      const strict = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name").notNull(),
      });
      const loose = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
      });

      await runner.run([strict.toJSON()], RUN_OPTS);
      const dropped = await runner.run([loose.toJSON()], RUN_OPTS);
      expect(dropped.rows.map((row) => row.sql)).toEqual([
        `ALTER TABLE "items" ALTER COLUMN "name" DROP NOT NULL`,
      ]);

      await runner.run([strict.toJSON()], RUN_OPTS); // NOT NULL again, now as a CHECK
      const viaCheck = await runner.run([loose.toJSON()], RUN_OPTS);
      expect(viaCheck.rows.map((row) => row.sql)).toEqual([
        `ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_name_not_null" RESTRICT`,
      ]);
      await pg.query(`INSERT INTO items (name) VALUES (NULL)`);
    });

    it("drops a column only when destructive steps are allowed", async () => {
      const v1 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
        legacy: text("legacy"),
      });
      const v2 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name"),
      });
      await runner.run([v1.toJSON()], RUN_OPTS);

      await expect(runner.run([v2.toJSON()], NO_DESTRUCTIVE)).rejects.toThrow(
        /DESTRUCTIVE_NOT_ALLOWED.*DROP column legacy/
      );

      const result = await runner.run([v2.toJSON()], RUN_OPTS);
      expect(result.rows.map((row) => [row.action, row.target, row.risk])).toEqual([
        ["DROP", "legacy", "destructive"],
      ]);
      expect((await runner.plan([v2.toJSON()], RUN_OPTS)).rows).toEqual([]);
    });

    it("changes a type by dropping and adding the column, and rebuilds its index", async () => {
      const v1 = table("items", { id: uuid("id").primaryKey().defaultRandom(), qty: int("qty") });
      v1.index("items_qty_idx").columns((c) => [c.qty]);
      const v2 = table("items", {
        id: uuid("id").primaryKey().defaultRandom(),
        qty: bigint("qty"),
      });
      v2.index("items_qty_idx").columns((c) => [c.qty]);
      await runner.run([v1.toJSON()], RUN_OPTS);

      const blocked = await runner.run([v2.toJSON()], NO_DESTRUCTIVE).catch((e: Error) => e);
      expect(String(blocked)).toMatch(/type change.*qty_v2/);

      const result = await runner.run([v2.toJSON()], RUN_OPTS);
      expect(result.rows.map((row) => [row.action, row.target, row.status])).toEqual([
        ["DROP", "qty", "completed"],
        ["ADD", "qty", "completed"],
        ["CREATE", "items_qty_idx", "completed"],
      ]);
      expect((await runner.plan([v2.toJSON()], RUN_OPTS)).rows).toEqual([]);
    });
  });

  describe("expression and partial indexes", () => {
    const users = (variant: { partial?: boolean; nullsFirst?: boolean } = {}) => {
      const t = table("people", {
        id: uuid("id").primaryKey().defaultRandom(),
        email: text("email"),
        deletedAt: text("deleted_at"),
      });
      const index = t
        .index("people_email_lower_idx")
        .columns((c) => [sql`lower(${c.email})`, variant.nullsFirst ? c.id.nullsFirst() : c.id]);
      if (variant.partial) index.where((c) => sql`${c.deletedAt} IS NULL`);
      return t.toJSON();
    };

    it("creates an expression and partial index, and plans nothing after", async () => {
      const result = await runner.run([users({ partial: true, nullsFirst: true })], RUN_OPTS);

      expect(result.rows.map((row) => row.sql)).toContain(
        `CREATE INDEX IF NOT EXISTS "people_email_lower_idx" ON "people" ` +
          `((lower("email")) NULLS LAST, "id" NULLS FIRST) NULLS DISTINCT WHERE "deleted_at" IS NULL`
      );
      expect(
        (await runner.plan([users({ partial: true, nullsFirst: true })], RUN_OPTS)).rows
      ).toEqual([]);

      // A query that implies the predicate and filters by the expression uses the index.
      await pg.query(`SET enable_seqscan = off`);
      const explained = await pg.query<Record<string, string>>(
        `EXPLAIN SELECT id FROM people WHERE lower(email) = 'a' AND deleted_at IS NULL`
      );
      expect(explained.rows.map((row) => Object.values(row).join("")).join("\n")).toContain(
        "people_email_lower_idx"
      );
    });

    it("rebuilds the index when it becomes partial", async () => {
      await runner.run([users()], RUN_OPTS);

      const result = await runner.run([users({ partial: true })], RUN_OPTS);

      expect(result.rows.map((row) => [row.action, row.status])).toEqual([
        ["DROP", "completed"],
        ["CREATE", "completed"],
      ]);
      expect((await runner.plan([users({ partial: true })], RUN_OPTS)).rows).toEqual([]);
    });
  });

  describe("domains and sequences", () => {
    const status = (v: { default?: string; notNull?: boolean; check?: string }) => {
      let d = domain("ticket_status");
      if (v.notNull) d = d.notNull() as typeof d;
      if (v.default) d = d.default(v.default) as typeof d;
      if (v.check) d = d.check((value) => sql`${value} <> ''`, v.check);
      return d.toJSON();
    };

    it("changes a domain's default, drops its NOT NULL and CHECK; refuses adding them", async () => {
      await runner.run(
        [status({ default: "open", notNull: true, check: "ticket_status_check" })],
        RUN_OPTS
      );

      const changed = await runner.run([status({ default: "new" })], RUN_OPTS);
      expect(changed.rows.map((row) => [row.action, row.targetKind, row.risk])).toEqual([
        ["ALTER", "DEFAULT", "safe"],
        ["DROP", "CONSTRAINT", "destructive"],
        ["DROP", "CONSTRAINT", "destructive"],
      ]);
      expect((await runner.plan([status({ default: "new" })], RUN_OPTS)).rows).toEqual([]);

      const refused = await runner.plan(
        [status({ default: "new", check: "ticket_status_check" })],
        RUN_OPTS
      );
      expect(refused.errors.map((error) => error.code)).toEqual(["NO_ALTER_DOMAIN_CONSTRAINT"]);
    });

    it("alters only a sequence's changed options, and plans nothing after", async () => {
      await runner.run([sequence("ticket_seq").toJSON()], RUN_OPTS);

      const next = sequence("ticket_seq").incrementBy(5).cache(65536);
      const result = await runner.run([next.toJSON()], RUN_OPTS);

      expect(result.rows.map((row) => row.sql)).toEqual([
        `ALTER SEQUENCE "public"."ticket_seq" INCREMENT BY 5 CACHE 65536`,
      ]);
      expect((await runner.plan([next.toJSON()], RUN_OPTS)).rows).toEqual([]);
    });
  });
});
