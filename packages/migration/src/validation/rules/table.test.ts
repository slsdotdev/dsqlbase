import { describe, expect, it } from "vitest";
import { AnyColumnDefinition, AnyTableDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { ValidationContext } from "../context.js";
import {
  duplicateColumnName,
  duplicateIndexCoverage,
  emptyConstraintColumns,
  multiplePrimaryKeys,
  redundantUniqueOnPk,
  tableIdentifiersTooLong,
  tableNoPrimaryKey,
  unknownColumnReference,
  varcharWithoutLength,
} from "./table.js";

type Column = SerializedObject<AnyColumnDefinition>;
type Table = SerializedObject<AnyTableDefinition>;

const baseColumn = (overrides: Partial<Column>): Column =>
  ({
    kind: "COLUMN",
    name: "id",
    dataType: "uuid",
    notNull: true,
    primaryKey: false,
    unique: false,
    defaultValue: null,
    check: null,
    domain: null,
    generated: null,
    identity: null,
    ...overrides,
  }) as Column;

const baseTable = (overrides: Partial<Table>): Table =>
  ({
    kind: "TABLE",
    name: "users",
    namespace: "public",
    columns: [],
    indexes: [],
    constraints: [],
    ...overrides,
  }) as Table;

const ctxFor = (table: Table) => new ValidationContext([table]);

describe("tableNoPrimaryKey", () => {
  it("passes when a column-level PK is declared", () => {
    const table = baseTable({ columns: [baseColumn({ primaryKey: true })] });
    const context = ctxFor(table);
    tableNoPrimaryKey(table, context);
    expect(context.issues).toEqual([]);
  });

  it("passes when a table-level PK constraint is declared", () => {
    const table = baseTable({
      columns: [baseColumn({})],
      constraints: [
        {
          kind: "PRIMARY_KEY_CONSTRAINT",
          name: "users_pk",
          columns: ["id"],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    tableNoPrimaryKey(table, context);
    expect(context.issues).toEqual([]);
  });

  it("reports a missing primary key", () => {
    const table = baseTable({ columns: [baseColumn({ primaryKey: false })] });
    const context = ctxFor(table);
    tableNoPrimaryKey(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("TABLE_NO_PRIMARY_KEY");
  });
});

describe("multiplePrimaryKeys", () => {
  it("does not report a single column-level primary key", () => {
    const table = baseTable({ columns: [baseColumn({ name: "id", primaryKey: true })] });
    const context = ctxFor(table);
    multiplePrimaryKeys(table, context);
    expect(context.issues).toEqual([]);
  });

  it("does not report a single composite primary key constraint", () => {
    const table = baseTable({
      columns: [
        baseColumn({ name: "team_id" }),
        baseColumn({ name: "user_id" }),
      ],
      constraints: [
        {
          kind: "PRIMARY_KEY_CONSTRAINT",
          name: "team_members_pk",
          columns: ["team_id", "user_id"],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    multiplePrimaryKeys(table, context);
    expect(context.issues).toEqual([]);
  });

  it("reports two columns flagged as primary key", () => {
    const table = baseTable({
      columns: [
        baseColumn({ name: "team_id", primaryKey: true }),
        baseColumn({ name: "user_id", primaryKey: true }),
      ],
    });
    const context = ctxFor(table);
    multiplePrimaryKeys(table, context);

    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("MULTIPLE_PRIMARY_KEYS");
    expect(context.issues[0]?.level).toBe("error");
    expect(context.issues[0]?.message).toContain('column "team_id", column "user_id"');
  });

  it("reports a flagged column combined with a table-level constraint", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true }), baseColumn({ name: "team_id" })],
      constraints: [
        {
          kind: "PRIMARY_KEY_CONSTRAINT",
          name: "users_pk",
          columns: ["team_id"],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    multiplePrimaryKeys(table, context);

    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("MULTIPLE_PRIMARY_KEYS");
    expect(context.issues[0]?.message).toContain('column "id", constraint "users_pk"');
  });
});

describe("duplicateColumnName", () => {
  it("does not report distinct column names", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true }), baseColumn({ name: "email" })],
    });
    const context = ctxFor(table);
    duplicateColumnName(table, context);
    expect(context.issues).toEqual([]);
  });

  it("reports a repeated column name once", () => {
    const table = baseTable({
      columns: [
        baseColumn({ name: "id", primaryKey: true }),
        baseColumn({ name: "display_name" }),
        baseColumn({ name: "display_name" }),
        baseColumn({ name: "display_name" }),
      ],
    });
    const context = ctxFor(table);
    duplicateColumnName(table, context);

    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("DUPLICATE_COLUMN_NAME");
    expect(context.issues[0]?.level).toBe("error");
    expect(context.issues[0]?.message).toContain('"display_name"');
  });

  it("reports each distinct duplicate separately", () => {
    const table = baseTable({
      columns: [
        baseColumn({ name: "a" }),
        baseColumn({ name: "a" }),
        baseColumn({ name: "b" }),
        baseColumn({ name: "b" }),
      ],
    });
    const context = ctxFor(table);
    duplicateColumnName(table, context);

    expect(context.issues).toHaveLength(2);
  });
});

describe("unknownColumnReference", () => {
  it("does not report when references resolve", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true })],
      constraints: [
        {
          kind: "UNIQUE_CONSTRAINT",
          name: "u",
          columns: ["id"],
          include: null,
          distinctNulls: true,
        },
      ],
      indexes: [
        {
          kind: "INDEX",
          name: "idx",
          unique: false,
          distinctNulls: true,
          columns: [
            {
              kind: "INDEX_COLUMN",
              name: "idx_column_id",
              sortDirection: "ASC",
              nulls: "LAST",
              column: "id",
            },
          ],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    unknownColumnReference(table, context);
    expect(context.issues).toEqual([]);
  });

  it("reports unknown column in a constraint", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true })],
      constraints: [
        {
          kind: "UNIQUE_CONSTRAINT",
          name: "u",
          columns: ["missing"],
          include: null,
          distinctNulls: true,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    unknownColumnReference(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("UNKNOWN_COLUMN_REFERENCE");
  });

  it("reports unknown column in an index", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true })],
      indexes: [
        {
          kind: "INDEX",
          name: "idx",
          unique: false,
          distinctNulls: true,
          columns: [
            {
              kind: "INDEX_COLUMN",
              name: "idx_column_missing",
              sortDirection: "ASC",
              nulls: "LAST",
              column: "missing",
            },
          ],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    unknownColumnReference(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("UNKNOWN_COLUMN_REFERENCE");
  });
});

describe("emptyConstraintColumns", () => {
  it("does not report a CHECK constraint", () => {
    const table = baseTable({
      columns: [baseColumn({ primaryKey: true })],
      constraints: [{ kind: "CHECK_CONSTRAINT", name: "c", expression: "id IS NOT NULL" }],
    } as Partial<Table>);
    const context = ctxFor(table);
    emptyConstraintColumns(table, context);
    expect(context.issues).toEqual([]);
  });

  it("reports a UNIQUE constraint with no columns", () => {
    const table = baseTable({
      columns: [baseColumn({ primaryKey: true })],
      constraints: [
        { kind: "UNIQUE_CONSTRAINT", name: "u", columns: [], include: null, distinctNulls: true },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    emptyConstraintColumns(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("EMPTY_CONSTRAINT_COLUMNS");
  });
});

describe("tableIdentifiersTooLong", () => {
  it("reports long column names via reused identifierTooLong", () => {
    const longName = "a".repeat(64);
    const table = baseTable({ columns: [baseColumn({ name: longName, primaryKey: true })] });
    const context = ctxFor(table);
    tableIdentifiersTooLong(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("IDENTIFIER_TOO_LONG");
  });
});

describe("redundantUniqueOnPk", () => {
  it("warns when a UNIQUE constraint covers the PK column set", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true })],
      constraints: [
        {
          kind: "UNIQUE_CONSTRAINT",
          name: "u",
          columns: ["id"],
          include: null,
          distinctNulls: true,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    redundantUniqueOnPk(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("REDUNDANT_UNIQUE_ON_PK");
    expect(context.issues[0]?.level).toBe("warning");
  });

  it("warns when a unique index covers the PK column set", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true })],
      indexes: [
        {
          kind: "INDEX",
          name: "idx",
          unique: true,
          distinctNulls: true,
          columns: [
            {
              kind: "INDEX_COLUMN",
              name: "idx_column_id",
              sortDirection: "ASC",
              nulls: "LAST",
              column: "id",
            },
          ],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    redundantUniqueOnPk(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("REDUNDANT_UNIQUE_ON_PK");
  });

  it("does not warn for unique constraint on different column set", () => {
    const table = baseTable({
      columns: [
        baseColumn({ name: "id", primaryKey: true }),
        baseColumn({ name: "email", dataType: "text" }),
      ],
      constraints: [
        {
          kind: "UNIQUE_CONSTRAINT",
          name: "u",
          columns: ["email"],
          include: null,
          distinctNulls: true,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    redundantUniqueOnPk(table, context);
    expect(context.issues).toEqual([]);
  });
});

describe("duplicateIndexCoverage", () => {
  it("warns on two indexes covering the same ordered column list", () => {
    const ic = (col: string, idx: string) =>
      ({
        kind: "INDEX_COLUMN",
        name: `${idx}_column_${col}`,
        sortDirection: "ASC",
        nulls: "LAST",
        column: col,
      }) as const;

    const table = baseTable({
      columns: [
        baseColumn({ name: "id", primaryKey: true }),
        baseColumn({ name: "email", dataType: "text" }),
      ],
      indexes: [
        {
          kind: "INDEX",
          name: "idx_a",
          unique: false,
          distinctNulls: true,
          columns: [ic("email", "idx_a")],
          include: null,
        },
        {
          kind: "INDEX",
          name: "idx_b",
          unique: false,
          distinctNulls: true,
          columns: [ic("email", "idx_b")],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    duplicateIndexCoverage(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("DUPLICATE_INDEX_COVERAGE");
  });

  it("does not warn for distinct column orderings", () => {
    const ic = (col: string, idx: string) =>
      ({
        kind: "INDEX_COLUMN",
        name: `${idx}_column_${col}`,
        sortDirection: "ASC",
        nulls: "LAST",
        column: col,
      }) as const;

    const table = baseTable({
      columns: [
        baseColumn({ name: "a" }),
        baseColumn({ name: "b" }),
        baseColumn({ name: "id", primaryKey: true }),
      ],
      indexes: [
        {
          kind: "INDEX",
          name: "idx_a",
          unique: false,
          distinctNulls: true,
          columns: [ic("a", "idx_a"), ic("b", "idx_a")],
          include: null,
        },
        {
          kind: "INDEX",
          name: "idx_b",
          unique: false,
          distinctNulls: true,
          columns: [ic("b", "idx_b"), ic("a", "idx_b")],
          include: null,
        },
      ],
    } as Partial<Table>);
    const context = ctxFor(table);
    duplicateIndexCoverage(table, context);
    expect(context.issues).toEqual([]);
  });
});

describe("varcharWithoutLength", () => {
  it("warns on a column with bare varchar", () => {
    const table = baseTable({
      columns: [
        baseColumn({ name: "id", primaryKey: true }),
        baseColumn({ name: "label", dataType: "varchar" }),
      ],
    });
    const context = ctxFor(table);
    varcharWithoutLength(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("VARCHAR_WITHOUT_LENGTH");
  });

  it("does not warn on varchar(n)", () => {
    const table = baseTable({
      columns: [
        baseColumn({ name: "id", primaryKey: true }),
        baseColumn({ name: "label", dataType: "varchar(255)" }),
      ],
    });
    const context = ctxFor(table);
    varcharWithoutLength(table, context);
    expect(context.issues).toEqual([]);
  });
});
