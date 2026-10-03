import { describe, expect, it } from "vitest";
import { ColumnDefinition, TableDefinition } from "@dsqlbase/core";
import { createPrinter } from "./ddl/index.js";
import { reconcileSchemas } from "./reconciliation/reconcile.js";
import { formatPlan, planRows } from "./report.js";

const print = createPrinter();

const users = (columns: Record<string, ColumnDefinition<string, never>>) =>
  new TableDefinition("users", {
    columns: { id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(), ...columns },
  });

// The remote has `nickname` and an index on it; the local drops the index, adds `email` with an
// identity-free unique flag (two-step promotion), and drops nothing else.
const remote = users({ nickname: new ColumnDefinition("nickname") as never });
remote.index("users_nickname_idx").columns((c) => [c.nickname]);

const local = users({
  nickname: new ColumnDefinition("nickname") as never,
  email: new ColumnDefinition("email").unique() as never,
  legacy: new ColumnDefinition("legacy").notNull() as never,
});

const plan = () => {
  const { operations, errors } = reconcileSchemas([local.toJSON()], [remote.toJSON()], {
    asyncIndexes: true,
  });
  return { operations, errors, rows: planRows(operations, errors, (op) => print(op.statement)) };
};

describe("planRows", () => {
  it("has one row per operation, in execution order, then one per refusal", () => {
    const { rows } = plan();

    expect(
      rows.map((row) => [
        row.step,
        row.changeStep,
        row.action,
        row.targetKind,
        row.target,
        row.risk,
      ])
    ).toEqual([
      [1, "1/3", "ADD", "COLUMN", "email", "safe"],
      [2, "2/3", "CREATE", "INDEX", "users_email_key_idx", "safe"],
      [3, "3/3", "ADD", "CONSTRAINT", "users_email_key", "safe"],
      [4, "1/1", "DROP", "INDEX", "users_nickname_idx", "lossy"],
      [null, "", "ADD", "COLUMN", "legacy", "refused"],
    ]);
  });

  it("names the subject, the attribute changes, the statement and the refusal", () => {
    const { rows } = plan();

    expect(rows[0]).toMatchObject({
      subject: "users",
      subjectKind: "TABLE",
      change: "users.email",
      changes: "dataType: text",
      destructive: false,
      async: false,
      sql: 'ALTER TABLE "users" ADD COLUMN "email" text',
      refusal: null,
    });
    expect(rows[1]).toMatchObject({ async: true, changes: "columns: email" });
    expect(rows[4]?.refusal).toEqual({
      code: "IMMUTABLE_COLUMN",
      message: expect.stringContaining('Column "legacy" cannot be added with inline NOT NULL'),
    });
  });
});

describe("formatPlan", () => {
  it("prints an aligned table, then the refusals' messages", () => {
    const text = formatPlan(plan());

    expect(text.split("\n").slice(0, 8)).toEqual([
      "#  Subject      Action        Target                      Changes                           Risk     Async",
      "-  -----------  ------------  --------------------------  --------------------------------  -------  -----",
      "1  table users  ADD (1/3)     column email                dataType: text                    safe",
      "2  table users  CREATE (2/3)  index users_email_key_idx   columns: email                    safe     async",
      "3  table users  ADD (3/3)     constraint users_email_key  unique: email                     safe",
      "4  table users  DROP          index users_nickname_idx                                      lossy",
      "–  table users  ADD           column legacy               IMMUTABLE_COLUMN: dataType: text  REFUSED",
      "",
    ]);
    expect(text).toContain('Refused users.legacy: Column "legacy" cannot be added');
  });

  it("prints a markdown table with the statements on request", () => {
    const text = formatPlan(plan(), { format: "markdown", sql: true });

    expect(text.split("\n")[0]).toBe(
      "| # | Subject | Action | Target | Changes | Risk | Async | SQL |"
    );
    expect(text).toContain('| ALTER TABLE "users" ADD COLUMN "email" text |');
  });

  it("says when there is nothing to do", () => {
    expect(formatPlan([])).toBe("Nothing to do: the database matches the definition.");
  });

  it("adds a status column and failures for executed rows", () => {
    const text = formatPlan(
      plan()
        .rows.slice(0, 1)
        .map((row) => ({
          ...row,
          status: "failed" as const,
          durationMs: 3,
          error: "duplicate column",
        }))
    );

    expect(text.split("\n")[0]).toContain("Status");
    expect(text).toContain("Failed step 1: duplicate column");
  });
});
