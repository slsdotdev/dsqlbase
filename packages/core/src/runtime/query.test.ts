import { beforeAll, describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  NamespaceDefinition,
  NodeRef,
  TableDefinition,
} from "../definition/index.js";
import { sql } from "../sql/index.js";
import { Table } from "./table.js";
import { QueryBuilder } from "./query.js";

const table = new Table(
  new TableDefinition("users", {
    columns: {
      id: new ColumnDefinition("id", { primaryKey: true }),
      name: new ColumnDefinition("name", { notNull: true }),
    },
  })
);

describe("Dialect", () => {
  let dialect: QueryBuilder;

  beforeAll(() => {
    dialect = new QueryBuilder();
  });

  it("should build a select query", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      limit: 10,
      offset: 0,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT * FROM "users" AS "__t0" LIMIT $1 OFFSET $2');
    expect(builtQuery.params).toEqual([10, 0]);
  });

  it("should build a select query with distinct", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      distinct: true,
      limit: 10,
      offset: 0,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT DISTINCT * FROM "users" AS "__t0" LIMIT $1 OFFSET $2');
    expect(builtQuery.params).toEqual([10, 0]);
  });

  it("should build a select query with selected fields", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [table.columns.id],
    });

    const { text } = query.toQuery();

    expect(text).toBe('SELECT "__t0"."id" FROM "users" AS "__t0"');
  });

  it("should build a select query with where clause", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      where: sql`${table.columns.id} = ${sql.param(1)}`,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT * FROM "users" AS "__t0" WHERE "__t0"."id" = $1');
    expect(builtQuery.params).toEqual([1]);
  });

  it("should build a select query with order by clause", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [],
      order: [sql`${table.columns.name} ASC`],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('SELECT * FROM "users" AS "__t0" ORDER BY "__t0"."name" ASC');
  });

  it("should build a select query with all clauses", () => {
    const query = dialect.buildSelectQuery({
      table,
      select: [table.columns.id, table.columns.name],
      where: sql`${table.columns.id} = ${sql.param(1)}`,
      order: [sql`${table.columns.name} ASC`],
      limit: 10,
      offset: 0,
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `SELECT "__t0"."id", "__t0"."name" FROM "users" AS "__t0" WHERE "__t0"."id" = $1 ORDER BY "__t0"."name" ASC LIMIT $2 OFFSET $3`
    );
    expect(builtQuery.params).toEqual([1, 10, 0]);
  });

  describe("lateral joins and aliasing", () => {
    const tasks = new Table(
      new TableDefinition("tasks", {
        columns: {
          id: new ColumnDefinition("id", { primaryKey: true }),
          title: new ColumnDefinition("title", { notNull: true }),
          parentId: new ColumnDefinition("parent_id"),
          assigneeId: new ColumnDefinition("assignee_id"),
        },
      })
    );

    const memberships = new Table(
      new TableDefinition("memberships", {
        columns: {
          teamId: new ColumnDefinition("team_id", { notNull: true }),
          userId: new ColumnDefinition("user_id", { notNull: true }),
          role: new ColumnDefinition("role"),
        },
      })
    );

    it("aliases every level and correlates the child to the parent", () => {
      const { text } = dialect
        .buildSelectQuery({
          table,
          select: [table.columns.id],
          join: [
            {
              alias: "tasks",
              type: "many",
              from: [table.columns.id],
              to: [tasks.columns.assigneeId],
              params: { table: tasks, select: [tasks.columns.title] },
            },
          ],
        })
        .toQuery();

      expect(text).toContain('FROM "users" AS "__t0"');
      expect(text).toContain('FROM "tasks" AS "__t1"');
      expect(text).toContain('WHERE "__t1"."assignee_id" = "__t0"."id"');
      expect(text).toContain('row_to_json("__j0".*)');
    });

    // The whole point of the story. Before aliasing, both sides of the correlation bound to
    // the inner FROM and the predicate silently became `parent_id = id` on a single row.
    it("gives the two sides of a self-join different aliases", () => {
      const { text } = dialect
        .buildSelectQuery({
          table: tasks,
          select: [tasks.columns.id],
          join: [
            {
              alias: "parent",
              type: "one",
              from: [tasks.columns.parentId],
              to: [tasks.columns.id],
              params: { table: tasks, select: [tasks.columns.title] },
            },
          ],
        })
        .toQuery();

      expect(text).toContain('FROM "tasks" AS "__t0"');
      expect(text).toContain('FROM "tasks" AS "__t1"');
      expect(text).toContain('WHERE "__t1"."id" = "__t0"."parent_id"');
      expect(text).not.toContain('"tasks"."id" = "tasks"."parent_id"');
    });

    it("keeps each level distinct through a nested join", () => {
      const { text } = dialect
        .buildSelectQuery({
          table,
          select: [table.columns.id],
          join: [
            {
              alias: "tasks",
              type: "many",
              from: [table.columns.id],
              to: [tasks.columns.assigneeId],
              params: {
                table: tasks,
                select: [tasks.columns.title],
                join: [
                  {
                    alias: "parent",
                    type: "one",
                    from: [tasks.columns.parentId],
                    to: [tasks.columns.id],
                    params: { table: tasks, select: [tasks.columns.title] },
                  },
                ],
              },
            },
          ],
        })
        .toQuery();

      expect(text).toContain('FROM "users" AS "__t0"');
      expect(text).toContain('FROM "tasks" AS "__t1"');
      expect(text).toContain('FROM "tasks" AS "__t2"');
      expect(text).toContain('WHERE "__t2"."id" = "__t1"."parent_id"');
      expect(text).toContain('WHERE "__t1"."assignee_id" = "__t0"."id"');
    });

    it("gives sibling joins on the same table their own aliases", () => {
      const { text } = dialect
        .buildSelectQuery({
          table: tasks,
          select: [tasks.columns.id],
          join: [
            {
              alias: "assignee",
              type: "one",
              from: [tasks.columns.assigneeId],
              to: [table.columns.id],
              params: { table, select: [table.columns.name] },
            },
            {
              alias: "reporter",
              type: "one",
              from: [tasks.columns.parentId],
              to: [table.columns.id],
              params: { table, select: [table.columns.name] },
            },
          ],
        })
        .toQuery();

      expect(text).toContain('WHERE "__t1"."id" = "__t0"."assignee_id"');
      expect(text).toContain('WHERE "__t2"."id" = "__t0"."parent_id"');
    });

    it("correlates over every column pair", () => {
      const { text } = dialect
        .buildSelectQuery({
          table,
          select: [table.columns.id],
          join: [
            {
              alias: "memberships",
              type: "many",
              from: [table.columns.id, table.columns.name],
              to: [memberships.columns.userId, memberships.columns.teamId],
              params: { table: memberships, select: [memberships.columns.role] },
            },
          ],
        })
        .toQuery();

      expect(text).toContain(
        'WHERE "__t1"."user_id" = "__t0"."id" AND "__t1"."team_id" = "__t0"."name"'
      );
    });

    it("ands the correlation with the joined level's own where", () => {
      const { text } = dialect
        .buildSelectQuery({
          table,
          select: [table.columns.id],
          join: [
            {
              alias: "tasks",
              type: "many",
              from: [table.columns.id],
              to: [tasks.columns.assigneeId],
              params: {
                table: tasks,
                select: [tasks.columns.title],
                where: sql`${tasks.columns.title} = ${sql.param("x")}`,
              },
            },
          ],
        })
        .toQuery();

      expect(text).toContain('WHERE "__t1"."assignee_id" = "__t0"."id" AND ("__t1"."title" = $1)');
    });

    it("rejects a join whose column pairs do not line up", () => {
      expect(() =>
        dialect.buildSelectQuery({
          table,
          select: [],
          join: [
            {
              alias: "tasks",
              type: "many",
              from: [table.columns.id],
              to: [tasks.columns.assigneeId, tasks.columns.parentId],
              params: { table: tasks, select: [] },
            },
          ],
        })
      ).toThrow(/must correlate an equal, non-zero number of columns/);
    });

    // Outside a select tree nothing is bound, so a column renders as it always has. This is
    // what keeps `$query` and every DML statement working unchanged.
    it("renders a column unqualified by any alias outside a select tree", () => {
      const { text } = sql`${table.columns.id}`.toQuery();

      expect(text).toBe('"users"."id"');
    });
  });

  describe("namespaced tables", () => {
    const invoices = new Table(
      new TableDefinition("invoices", {
        namespace: new NodeRef(new NamespaceDefinition("billing")),
        columns: {
          id: new ColumnDefinition("id", { primaryKey: true }),
          total: new ColumnDefinition("total"),
          relatedId: new ColumnDefinition("related_id"),
        },
      })
    );

    // Same table NAME as billing.invoices, different schema.
    const publicInvoices = new Table(
      new TableDefinition("invoices", {
        columns: {
          id: new ColumnDefinition("id", { primaryKey: true }),
          billingId: new ColumnDefinition("billing_id"),
        },
      })
    );

    // The source keeps its schema; the alias replaces the qualifier on every column.
    it("keeps the schema on the source and uses the alias on references", () => {
      const { text } = dialect
        .buildSelectQuery({ table: invoices, select: [invoices.columns.id] })
        .toQuery();

      expect(text).toBe('SELECT "__t0"."id" FROM "billing"."invoices" AS "__t0"');
    });

    it("aliases both sides of a self-join on a namespaced table", () => {
      const { text } = dialect
        .buildSelectQuery({
          table: invoices,
          select: [invoices.columns.id],
          join: [
            {
              alias: "related",
              type: "one",
              from: [invoices.columns.relatedId],
              to: [invoices.columns.id],
              params: { table: invoices, select: [invoices.columns.total] },
            },
          ],
        })
        .toQuery();

      expect(text).toContain('FROM "billing"."invoices" AS "__t0"');
      expect(text).toContain('FROM "billing"."invoices" AS "__t1"');
      expect(text).toContain('WHERE "__t1"."id" = "__t0"."related_id"');
    });

    // Two different tables that share a name across schemas collapse the same way a
    // self-join does: both sides used to qualify as "invoices" and bound to the inner FROM.
    it("distinguishes two tables that share a name across schemas", () => {
      const { text } = dialect
        .buildSelectQuery({
          table: publicInvoices,
          select: [publicInvoices.columns.id],
          join: [
            {
              alias: "billing",
              type: "one",
              from: [publicInvoices.columns.billingId],
              to: [invoices.columns.id],
              params: { table: invoices, select: [invoices.columns.total] },
            },
          ],
        })
        .toQuery();

      expect(text).toContain('FROM "invoices" AS "__t0"');
      expect(text).toContain('FROM "billing"."invoices" AS "__t1"');
      expect(text).toContain('WHERE "__t1"."id" = "__t0"."billing_id"');
      expect(text).not.toContain('"invoices"."id" = "invoices"."billing_id"');
    });

    // DML has no select tree, so nothing is aliased. A column stays qualified by the table
    // name — never the schema — which is how Postgres resolves it against `DELETE FROM`.
    it("leaves a namespaced DML statement unaliased", () => {
      const { text } = dialect
        .buildDeleteQuery({
          table: invoices,
          where: sql`${invoices.columns.id} = ${sql.param(1)}`,
          return: [invoices.columns.id],
        })
        .toQuery();

      expect(text).toBe(
        'DELETE FROM "billing"."invoices" WHERE "invoices"."id" = $1 RETURNING "invoices"."id"'
      );
    });
  });

  it("should build an insert query", () => {
    const query = dialect.buildInsertQuery({
      table,
      columns: [sql.identifier(table.columns.id.name), sql.identifier(table.columns.name.name)],
      values: [
        [sql.param(1), sql.param("Alice")],
        [sql.param(2), sql.param("Bob")],
      ],
      return: [table.columns.id],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `INSERT INTO "users" ("id", "name") VALUES ($1, $2), ($3, $4) RETURNING "users"."id"`
    );
    expect(builtQuery.params).toEqual([1, "Alice", 2, "Bob"]);
  });

  it("should build an update query", () => {
    const query = dialect.buildUpdateQuery({
      table,
      set: [[sql.identifier(table.columns.name.name), sql.param("Charlie")]],
      where: sql`${table.columns.id} = ${sql.param(1)}`,
      return: [table.columns.name],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `UPDATE "users" SET "name" = $1 WHERE "users"."id" = $2 RETURNING "users"."name"`
    );
    expect(builtQuery.params).toEqual(["Charlie", 1]);
  });

  it("should build a delete query", () => {
    const query = dialect.buildDeleteQuery({
      table,
      where: sql`${table.columns.id} = ${sql.param(1)}`,
      return: [table.columns.id],
    });

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      `DELETE FROM "users" WHERE "users"."id" = $1 RETURNING "users"."id"`
    );
    expect(builtQuery.params).toEqual([1]);
  });
});
