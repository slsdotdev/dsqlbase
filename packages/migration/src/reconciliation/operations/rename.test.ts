import { describe, expect, it } from "vitest";
import { ColumnDefinition, TableDefinition } from "@dsqlbase/core";
import { createPrinter } from "../../ddl/index.js";
import { reconcileSchemas } from "../reconcile.js";
import { SerializedSchema } from "../../base.js";

const print = createPrinter();
const sqlOf = (local: SerializedSchema, remote: SerializedSchema) => {
  const { operations, errors } = reconcileSchemas(local, remote, { asyncIndexes: false });
  return { sql: operations.map((op) => print(op.statement).text), errors, operations };
};

const users = (columns: Record<string, ColumnDefinition<string, never>>, name = "users") =>
  new TableDefinition(name, {
    columns: { id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(), ...columns },
  });

/** A table as introspection reads it: a column's UNIQUE is a named, table-level constraint. */
const introspected = (table: TableDefinition<string, never, never>) => {
  const json = table.toJSON();
  return {
    ...json,
    columns: json.columns.map((column) => ({ ...column, unique: false })),
    constraints: [
      ...json.constraints,
      ...json.columns
        .filter((column) => column.unique)
        .map((column) => ({
          kind: "UNIQUE_CONSTRAINT",
          name: `${json.name}_${column.name}_key`,
          columns: [column.name],
          include: null,
          distinctNulls: true,
        })),
    ],
  } as typeof json;
};

describe("renamedFrom", () => {
  it("renames a column instead of dropping one and adding another", () => {
    const remote = users({ name: new ColumnDefinition("name") as never });
    const local = users({
      fullName: new ColumnDefinition("full_name").renamedFrom("name") as never,
    });

    const result = sqlOf([local.toJSON()], [remote.toJSON()]);

    expect(result.errors).toEqual([]);
    expect(result.sql).toEqual([`ALTER TABLE "users" RENAME COLUMN "name" TO "full_name"`]);
    expect(result.operations[0]?.summary).toMatchObject({ action: "RENAME", risk: "safe" });
  });

  it("renames the constraints named after the column with it", () => {
    const remote = users({ email: new ColumnDefinition("email").unique() as never });
    const local = users({
      mail: new ColumnDefinition("mail").unique().renamedFrom("email") as never,
    });

    expect(sqlOf([local.toJSON()], [introspected(remote as never)]).sql).toEqual([
      `ALTER TABLE "users" RENAME COLUMN "email" TO "mail"`,
      `ALTER TABLE "users" RENAME CONSTRAINT "users_email_key" TO "users_mail_key"`,
    ]);
  });

  it("does nothing once the database has the new name", () => {
    const local = users({
      fullName: new ColumnDefinition("full_name").renamedFrom("name") as never,
    });

    expect(sqlOf([local.toJSON()], [local.toJSON()]).sql).toEqual([]);
  });

  it("refuses a rename when both names exist", () => {
    const remote = users({
      name: new ColumnDefinition("name") as never,
      fullName: new ColumnDefinition("full_name") as never,
    });
    const local = users({
      name: new ColumnDefinition("name") as never,
      fullName: new ColumnDefinition("full_name").renamedFrom("name") as never,
    });

    expect(sqlOf([local.toJSON()], [remote.toJSON()]).errors).toEqual([
      expect.objectContaining({ code: "RENAME_CONFLICT", subject: "full_name" }),
    ]);
  });

  it("renames a table, and what is named after it", () => {
    const remote = users({ email: new ColumnDefinition("email").unique() as never });
    const local = users(
      { email: new ColumnDefinition("email").unique() as never },
      "people"
    ).renamedFrom("users");

    expect(sqlOf([local.toJSON()], [introspected(remote as never)]).sql).toEqual([
      `ALTER TABLE "users" RENAME TO "people"`,
      `ALTER TABLE "people" RENAME CONSTRAINT "users_email_key" TO "people_email_key"`,
    ]);
  });
});

describe("renamedFrom — table and column together", () => {
  it("renames what is named after both in one step", () => {
    const remote = users({ name: new ColumnDefinition("name").unique() as never });
    const local = users(
      { fullName: new ColumnDefinition("full_name").unique().renamedFrom("name") as never },
      "people"
    ).renamedFrom("users");

    expect(sqlOf([local.toJSON()], [introspected(remote as never)]).sql).toEqual([
      `ALTER TABLE "users" RENAME TO "people"`,
      `ALTER TABLE "people" RENAME CONSTRAINT "users_name_key" TO "people_full_name_key"`,
      `ALTER TABLE "people" RENAME COLUMN "name" TO "full_name"`,
    ]);
  });
});

describe("deprecated", () => {
  it("marks the column, and drops a NOT NULL it has no default for", () => {
    const remote = users({ nickname: new ColumnDefinition("nickname").notNull() as never });
    const local = users({
      nickname: new ColumnDefinition("nickname").notNull().deprecated() as never,
    });

    const result = sqlOf([local.toJSON()], [remote.toJSON()]);

    expect(result.sql).toEqual([
      `ALTER TABLE "users" ALTER COLUMN "nickname" DROP NOT NULL`,
      `COMMENT ON COLUMN "users"."nickname" IS 'dsqlbase:deprecated'`,
    ]);
    expect(result.operations.map((op) => op.summary.risk)).toEqual(["lossy", "safe"]);
  });

  it("drops a deprecated column as a lossy step, not a destructive one", () => {
    const remote = users({ nickname: new ColumnDefinition("nickname").deprecated() as never });

    const [drop] = sqlOf([users({}).toJSON()], [remote.toJSON()]).operations;

    expect(drop?.summary).toMatchObject({
      action: "DROP",
      risk: "lossy",
      note: expect.stringMatching(/deprecated in an earlier release/),
    });
  });

  it("removes the marker when the column is no longer deprecated", () => {
    const remote = users({ nickname: new ColumnDefinition("nickname").deprecated() as never });
    const local = users({ nickname: new ColumnDefinition("nickname") as never });

    expect(sqlOf([local.toJSON()], [remote.toJSON()]).sql).toEqual([
      `COMMENT ON COLUMN "users"."nickname" IS NULL`,
    ]);
  });
});
