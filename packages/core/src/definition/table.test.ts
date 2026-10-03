import { describe, expect, it } from "vitest";

import { TableDefinition } from "./table.js";
import { ColumnDefinition } from "./column.js";
import { TenantScopeDefinition } from "./tenant.js";
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

    expect(json.constraints).toBeDefined();
    expect(json.constraints).toHaveLength(1);
    expect(json.constraints?.[0]).toMatchObject({
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

    expect(json.constraints).toBeDefined();
    expect(json.constraints).toHaveLength(1);
    expect(json.constraints?.[0]).toMatchObject({
      kind: "UNIQUE_CONSTRAINT",
      columns: ["team_id", "user_id"],
    });
  });

  it("should reject two fields mapping to the same column", () => {
    expect(
      () =>
        new TableDefinition("users", {
          columns: {
            name: new ColumnDefinition("display_name"),
            displayName: new ColumnDefinition("display_name"),
          },
        })
    ).toThrow(/maps fields "name" and "displayName" to the same column "display_name"/);
  });

  it("should accept fields whose aliases differ from distinct column names", () => {
    const users = new TableDefinition("users", {
      columns: {
        displayName: new ColumnDefinition("display_name"),
        createdAt: new ColumnDefinition("created_at"),
      },
    });

    expect(Object.keys(users.columns)).toEqual(["displayName", "createdAt"]);
  });

  it("should add composite primary key constraint", () => {
    const members = new TableDefinition("team_members", {
      columns: {
        teamId: new ColumnDefinition("team_id").notNull(),
        userId: new ColumnDefinition("user_id").notNull(),
      },
    });

    members.primaryKey((c) => [c.teamId, c.userId]);

    const json = members.toJSON();

    expect(json.constraints).toHaveLength(1);
    expect(json.constraints?.[0]).toMatchObject({
      kind: "PRIMARY_KEY_CONSTRAINT",
      name: "team_members_primary_key",
      columns: ["team_id", "user_id"],
    });
  });

  // PostgreSQL makes every primary-key column NOT NULL; the serialized table says so too, or it
  // would read as a NOT NULL change against every database it was applied to.
  it("serializes the columns of a composite primary key as NOT NULL", () => {
    const tags = new TableDefinition("article_tags", {
      columns: {
        articleId: new ColumnDefinition("article_id"),
        tagId: new ColumnDefinition("tag_id"),
        note: new ColumnDefinition("note"),
      },
    });

    tags.primaryKey((c) => [c.articleId, c.tagId]);

    expect(tags.toJSON().columns.map((c) => [c.name, c.notNull])).toEqual([
      ["article_id", true],
      ["tag_id", true],
      ["note", false],
    ]);
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
    expect(json.indexes[0].columns[0].column).toBe("project_id");
    expect(json.indexes[0].columns[1].column).toBe("status");
  });
});

describe("TableDefinition meta", () => {
  const columns = { id: new ColumnDefinition("id").primaryKey() };

  it("returns the definition so it chains off `table()`", () => {
    const definition = new TableDefinition("users", { columns });

    expect(definition.meta({ __typename: "User" })).toBe(definition);
  });

  it("accepts metadata through the constructor config", () => {
    const definition = new TableDefinition("users", { columns, meta: { __typename: "User" } });

    expect(definition["_meta"]).toEqual({ __typename: "User" });
  });

  it("keeps metadata out of toJSON, so it never reaches a migration", () => {
    const json = new TableDefinition("users", { columns }).meta({ __typename: "User" }).toJSON();

    expect(json).not.toHaveProperty("meta");
    expect(JSON.stringify(json)).not.toContain("__typename");
  });
});

describe("TableDefinition reserved field names", () => {
  it.each(["$$meta", "$$key"])("rejects a column named %s", (field) => {
    expect(
      () => new TableDefinition("users", { columns: { [field]: new ColumnDefinition("value") } })
    ).toThrow(`declares a column named "${field}", which is reserved`);
  });

  it("allows those names as database column names, which are a separate namespace", () => {
    expect(
      () => new TableDefinition("users", { columns: { meta: new ColumnDefinition("$$meta") } })
    ).not.toThrow();
  });
});

describe("TableDefinition tenant claims", () => {
  it("rejects a claim column that is not notNull", () => {
    expect(
      () =>
        new TableDefinition("invoices", {
          columns: {
            workspaceId: new ColumnDefinition("workspace_id", { tenantKey: true, readOnly: true }),
            id: new ColumnDefinition("id").primaryKey(),
          },
        })
    ).toThrow(/declares claim "workspaceId" as nullable/);
  });

  it("rejects a claim column the caller could write", () => {
    expect(
      () =>
        new TableDefinition("invoices", {
          columns: {
            workspaceId: new ColumnDefinition("workspace_id", { tenantKey: true }).notNull(),
            id: new ColumnDefinition("id").primaryKey(),
          },
        })
    ).toThrow(/declares claim "workspaceId" as writable/);
  });

  it("accepts the columns a tenant scope hands over", () => {
    const ws = new TenantScopeDefinition({
      workspaceId: new ColumnDefinition("workspace_id").notNull(),
    });

    expect(() =>
      ws.table("invoices", { id: new ColumnDefinition("id").primaryKey() })
    ).not.toThrow();
  });
});

describe("TableDefinition — deprecated() and renamedFrom()", () => {
  it("serializes a deprecated column, NOT NULL dropped when it has no default", () => {
    const people = new TableDefinition("people", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
        nickname: new ColumnDefinition("nickname").notNull().deprecated(),
        status: new ColumnDefinition("status").notNull().default("new").deprecated(),
      },
    });

    expect(people.toJSON().columns.map((c) => [c.name, c.deprecated, c.notNull])).toEqual([
      ["id", false, true],
      ["nickname", true, false],
      ["status", true, true],
    ]);
  });

  it("serializes renames of a table and its columns", () => {
    const people = new TableDefinition("people", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
        fullName: new ColumnDefinition("full_name").renamedFrom("name"),
      },
    }).renamedFrom("users");

    const json = people.toJSON();

    expect(json.renamedFrom).toBe("users");
    expect(json.columns.map((c) => c.renamedFrom)).toEqual([null, "name"]);
  });

  it("refuses deprecating a primary-key column", () => {
    expect(
      () =>
        new TableDefinition("people", {
          columns: { id: new ColumnDefinition("id").primaryKey().deprecated() },
        })
    ).toThrow(/deprecates "id", part of its primary key/);
  });
});
