import { describe, expect, it } from "vitest";
import { TableDefinition } from "./table.js";
import { ColumnDefinition } from "./column.js";
import { sql } from "../sql/index.js";

const tasks = new TableDefinition("tasks", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    projectId: new ColumnDefinition("project_id").notNull(),
    status: new ColumnDefinition("status").notNull(),
    dueDate: new ColumnDefinition("due_date"),
  },
});

describe("IndexDefinition", () => {
  it("takes an expression over its columns as a key, in order", () => {
    const json = tasks
      .index("tasks_status_lower_idx")
      .columns((c) => [c.projectId, sql`lower(${c.status})`])
      .toJSON();

    expect(json.columns).toEqual([
      {
        kind: "INDEX_COLUMN",
        name: "tasks_status_lower_idx_column_project_id",
        nulls: "LAST",
        column: "project_id",
      },
      {
        kind: "INDEX_COLUMN",
        name: "tasks_status_lower_idx_expression_1",
        nulls: "LAST",
        column: null,
        expression: 'lower("status")',
      },
    ]);
  });

  it("is partial with a predicate", () => {
    const json = tasks
      .index("tasks_open_idx")
      .columns((c) => [c.dueDate])
      .where((c) => sql`${c.status} <> 'done'`)
      .toJSON();

    expect(json.where).toBe(`"status" <> 'done'`);
  });

  it("has no predicate by default", () => {
    expect(tasks.index("tasks_plain_idx").toJSON().where).toBeNull();
  });

  it("should create with default config", () => {
    const idx = tasks.index("tasks_default_idx");
    const json = idx.toJSON();

    expect(json.kind).toBe("INDEX");
    expect(json.name).toBe("tasks_default_idx");
    expect(json.unique).toBe(false);
    expect(json.columns).toEqual([]);
    expect(json.distinctNulls).toBe(true);
    expect(json.include).toBeNull();
  });

  it("should set unique", () => {
    const json = tasks.index("tasks_unique_idx").unique().toJSON();
    expect(json.unique).toBe(true);
  });

  it("should add columns", () => {
    const json = tasks
      .index("tasks_project_idx")
      .columns((c) => [c.projectId])
      .toJSON();

    expect(json.columns).toHaveLength(1);
    expect(json.columns[0].column).toBe("project_id");
  });

  it("should add multiple columns", () => {
    const json = tasks
      .index("tasks_project_status_idx")
      .columns((c) => [c.projectId, c.status])
      .toJSON();

    expect(json.columns).toHaveLength(2);
    expect(json.columns[0].column).toBe("project_id");
    expect(json.columns[1].column).toBe("status");
  });

  it("should add columns with nulls first", () => {
    const json = tasks
      .index("tasks_due_date_idx")
      .columns((c) => [c.dueDate.nullsFirst()])
      .toJSON();

    expect(json.columns[0].nulls).toBe("FIRST");
  });

  it("should add columns with nulls last", () => {
    const json = tasks
      .index("tasks_due_date_idx2")
      .columns((c) => [c.dueDate.nullsLast()])
      .toJSON();

    expect(json.columns[0].nulls).toBe("LAST");
  });

  it("should set include columns", () => {
    const json = tasks
      .index("tasks_include_idx")
      .columns((c) => [c.projectId])
      .include((c) => [c.status])
      .toJSON();

    expect(json.include).toHaveLength(1);
    expect(json.include?.[0]).toBe("status");
  });

  it("should set nulls distinct", () => {
    const json = tasks.index("tasks_nd_idx").distinctNulls(false).toJSON();
    expect(json.distinctNulls).toBe(false);
  });
});
