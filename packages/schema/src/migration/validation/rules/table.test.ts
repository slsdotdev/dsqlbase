import { AnyColumnDefinition, AnyTableDefinition } from "@dsqlbase/core/definition";
import { describe, expect, it } from "vitest";
import { SerializedObject } from "../../base.js";
import { ValidationContext } from "../context.js";
import {
  duplicateIndexCoverage,
  emptyConstraintColumns,
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

describe("unknownColumnReference", () => {
  it("does not report when references resolve", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true })],
      constraints: [
        { kind: "UNIQUE_CONSTRAINT", name: "u", columns: ["id"], include: null, distinctNulls: true },
      ],
      indexes: [
        {
          kind: "INDEX",
          name: "idx",
          unique: false,
          distinctNulls: true,
          columns: [
            { kind: "INDEX_COLUMN", name: "idx_column_id", sortDirection: "ASC", nulls: "LAST", column: "id" },
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
        { kind: "UNIQUE_CONSTRAINT", name: "u", columns: ["missing"], include: null, distinctNulls: true },
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
            { kind: "INDEX_COLUMN", name: "idx_column_missing", sortDirection: "ASC", nulls: "LAST", column: "missing" },
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
        { kind: "UNIQUE_CONSTRAINT", name: "u", columns: ["id"], include: null, distinctNulls: true },
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
            { kind: "INDEX_COLUMN", name: "idx_column_id", sortDirection: "ASC", nulls: "LAST", column: "id" },
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
      columns: [baseColumn({ name: "id", primaryKey: true }), baseColumn({ name: "email", dataType: "text" })],
      constraints: [
        { kind: "UNIQUE_CONSTRAINT", name: "u", columns: ["email"], include: null, distinctNulls: true },
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
      columns: [baseColumn({ name: "id", primaryKey: true }), baseColumn({ name: "email", dataType: "text" })],
      indexes: [
        { kind: "INDEX", name: "idx_a", unique: false, distinctNulls: true, columns: [ic("email", "idx_a")], include: null },
        { kind: "INDEX", name: "idx_b", unique: false, distinctNulls: true, columns: [ic("email", "idx_b")], include: null },
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
      columns: [baseColumn({ name: "a" }), baseColumn({ name: "b" }), baseColumn({ name: "id", primaryKey: true })],
      indexes: [
        { kind: "INDEX", name: "idx_a", unique: false, distinctNulls: true, columns: [ic("a", "idx_a"), ic("b", "idx_a")], include: null },
        { kind: "INDEX", name: "idx_b", unique: false, distinctNulls: true, columns: [ic("b", "idx_b"), ic("a", "idx_b")], include: null },
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
      columns: [baseColumn({ name: "id", primaryKey: true }), baseColumn({ name: "label", dataType: "varchar" })],
    });
    const context = ctxFor(table);
    varcharWithoutLength(table, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("VARCHAR_WITHOUT_LENGTH");
  });

  it("does not warn on varchar(n)", () => {
    const table = baseTable({
      columns: [baseColumn({ name: "id", primaryKey: true }), baseColumn({ name: "label", dataType: "varchar(255)" })],
    });
    const context = ctxFor(table);
    varcharWithoutLength(table, context);
    expect(context.issues).toEqual([]);
  });
});
