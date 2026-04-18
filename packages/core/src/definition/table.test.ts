import { describe, expect, it } from "vitest";

import { TableDefinition } from "./table.js";
import { ColumnDefinition } from "./column.js";
import { sql } from "../sql/tag.js";

const usersTable = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").notNull().unique(),
  },
});

describe("Table", () => {
  it("should create a TableBuilder with the correct name and columns", () => {
    expect(usersTable.name).toBe("users");
    expect(usersTable.columns).toHaveProperty("id");
    expect(usersTable.columns).toHaveProperty("name");
  });

  it("should serialize columns as array", () => {
    const json = usersTable.toJSON();

    expect(Array.isArray(json.columns)).toBe(true);
    expect(json.columns).toHaveLength(3);
    expect(json.columns[0]).toMatchObject({ name: "id", primaryKey: true });
    expect(json.columns[1]).toMatchObject({ name: "name", notNull: true });
    expect(json.columns[2]).toMatchObject({ name: "email", unique: true });
  });

  it("should add table-level check constraint", () => {
    const orders = new TableDefinition("orders", {
      columns: {
        startDate: new ColumnDefinition("start_date").notNull(),
        endDate: new ColumnDefinition("end_date").notNull(),
      },
    });

    orders.check((c) => sql`${c.startDate} < ${c.endDate}`);

    const json = orders.toJSON();

    expect(json.checks).toBeDefined();
    expect(json.checks).toHaveLength(1);
    expect(json.checks?.[0]).toMatchObject({
      kind: "CHECK_CONSTRAINT",
      expression: '"start_date" < "end_date"',
    });
  });

  it("should add composite unique constraint", () => {
    const members = new TableDefinition("team_members", {
      columns: {
        teamId: new ColumnDefinition("team_id").notNull(),
        userId: new ColumnDefinition("user_id").notNull(),
      },
    });

    members.unique((c) => [c.teamId, c.userId]);

    const json = members.toJSON();

    expect(json.unique).toBeDefined();
    expect(json.unique).toHaveLength(1);
    expect(json.unique?.[0]).toHaveLength(2);
    expect(json.unique?.[0][0].name).toBe("team_id");
    expect(json.unique?.[0][1].name).toBe("user_id");
  });

  it("should serialize index with columns", () => {
    const tasks = new TableDefinition("tasks", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
        projectId: new ColumnDefinition("project_id").notNull(),
        status: new ColumnDefinition("status").notNull(),
      },
    });

    tasks
      .index("tasks_project_status_idx", { unique: true })
      .columns((c) => [c.projectId, c.status]);

    const json = tasks.toJSON();

    expect(json.indexes).toHaveLength(1);
    expect(json.indexes[0].name).toBe("tasks_project_status_idx");
    expect(json.indexes[0].unique).toBe(true);
    expect(json.indexes[0].columns).toHaveLength(2);
    expect(json.indexes[0].columns[0].column.name).toBe("project_id");
    expect(json.indexes[0].columns[1].column.name).toBe("status");
  });
});
