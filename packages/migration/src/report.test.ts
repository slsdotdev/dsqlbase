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

// The remote has `nickname` and an index on it; the local drops the index, adds `email` and its
// UNIQUE (a two-step promotion), and adds `legacy` NOT NULL, which is refused.
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
      [1, "1/1", "ADD", "COLUMN", "email", "safe"],
      [2, "1/1", "DROP", "INDEX", "users_nickname_idx", "lossy"],
      [3, "1/2", "CREATE", "INDEX", "users_email_key_idx", "safe"],
      [4, "2/2", "ADD", "CONSTRAINT", "users_email_key", "safe"],
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
      sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text',
      refusal: null,
    });
    expect(rows[2]).toMatchObject({ async: true, changes: "columns: email" });
    expect(rows[4]?.refusal).toEqual({
      code: "NOT_NULL_NEEDS_DEFAULT",
      message: expect.stringContaining(`Column "legacy" can't be added NOT NULL without a default`),
    });
  });
});

describe("formatPlan", () => {
  it("prints an aligned table, then the refusals' messages", () => {
    const text = formatPlan(plan());

    expect(text.split("\n").slice(0, 8)).toEqual([
      "#  Subject      Action        Target                      Changes                                 Risk     Async",
      "-  -----------  ------------  --------------------------  --------------------------------------  -------  -----",
      "1  table users  ADD           column email                dataType: text                          safe",
      "2  table users  DROP          index users_nickname_idx                                            lossy",
      "3  table users  CREATE (1/2)  index users_email_key_idx   columns: email                          safe     async",
      "4  table users  ADD (2/2)     constraint users_email_key  unique: email                           safe",
      "–  table users  ADD           column legacy               NOT_NULL_NEEDS_DEFAULT: dataType: text  REFUSED",
      "",
    ]);
    expect(text).toContain(`Refused users.legacy: Column "legacy" can't be added NOT NULL`);
  });

  it("prints a markdown table with the statements on request", () => {
    const text = formatPlan(plan(), { format: "markdown", sql: true });

    expect(text.split("\n")[0]).toBe(
      "| # | Subject | Action | Target | Changes | Risk | Async | SQL |"
    );
    expect(text).toContain('| ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text |');
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

  it("renders lists as names, index columns by their column, objects by their name", () => {
    const [row] = planRows(
      [
        {
          id: 0,
          type: "CREATE",
          object: { kind: "INDEX", name: "idx" } as never,
          statement: { __kind: "CREATE_INDEX" } as never,
          summary: {
            change: "t.idx",
            step: 1,
            steps: 1,
            subject: { kind: "TABLE", name: "t" },
            action: "CREATE",
            target: { kind: "INDEX", name: "idx" },
            changes: [
              {
                attribute: "columns",
                from: [{ column: "qty" }],
                to: [{ column: "qty" }, { column: "sku" }],
              },
              { attribute: "include", from: null, to: ["a", "b"] },
              {
                attribute: "check",
                from: { kind: "CHECK_CONSTRAINT", name: "qty_positive", expression: "qty > 0" },
                to: null,
              },
            ],
            risk: "safe",
            async: true,
          },
        },
      ],
      [],
      () => ({ text: "", params: [] })
    );

    expect(row?.changes).toBe("columns: qty → qty, sku; include: a, b; check: qty_positive → none");
  });

  it("lists the notes of destructive and blocked steps under the table", () => {
    const text = formatPlan(
      plan()
        .rows.slice(0, 1)
        .map((row) => ({
          ...row,
          risk: "destructive" as const,
          destructive: true,
          blocked: true,
          note: "its data is lost",
        }))
    );

    expect(text.split("\n").at(-1)).toBe("Step 1: its data is lost");
  });
});
