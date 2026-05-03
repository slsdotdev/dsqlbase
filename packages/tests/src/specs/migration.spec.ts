import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SQLStatement } from "@dsqlbase/core";
import { Session } from "@dsqlbase/core/runtime";
import { domain, int, sequence, table, text, uuid, varchar } from "@dsqlbase/schema/definition";
import {
  createMigrationRunner,
  introspect,
  MigrationRunner,
  type SerializedSchema,
} from "@dsqlbase/schema/migration";

class PGliteSession implements Session {
  constructor(private readonly pg: PGlite) {}

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this.pg.query(query.text, [...query.params]);
    return result.rows as T[];
  }
}

// PGlite cannot run DSQL ASYNC indexes. safeOperations adds IF NOT EXISTS so
// re-runs don't error, destructive lets us drop orphaned objects.
const RUN_OPTS = { asyncIndexes: false, safeOperations: true, destructive: true };

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

  it("refuses dropping a column from an existing table", async () => {
    const v1 = table("widgets", {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
      legacy: text("legacy"),
    });

    const v2 = table("widgets", {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
    });

    await runner.run([v1.toJSON()], RUN_OPTS);
    const plan = await runner.plan([v2.toJSON()], RUN_OPTS);

    expect(plan.errors.some((e) => e.code === "NO_DROP_COLUMN")).toBe(true);
    await expect(runner.run([v2.toJSON()], RUN_OPTS)).rejects.toThrow();
  });

  it("refuses changing a column data type on an existing table", async () => {
    const v1 = table("widgets", {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
    });

    const v2 = table("widgets", {
      id: uuid("id").primaryKey(),
      name: varchar("name", 200).notNull(),
    });

    await runner.run([v1.toJSON()], RUN_OPTS);
    const plan = await runner.plan([v2.toJSON()], RUN_OPTS);

    expect(plan.errors.some((e) => e.code === "IMMUTABLE_COLUMN")).toBe(true);
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
});
