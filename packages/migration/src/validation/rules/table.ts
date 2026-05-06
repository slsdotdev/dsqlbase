import { AnyTableDefinition } from "@dsqlbase/core/definition";
import { Rule } from "../context.js";
import { identifierTooLong } from "./global.js";

type TableRule = Rule<AnyTableDefinition>;

export const tableNoPrimaryKey: TableRule = (table, context) => {
  const hasColumnPk = table.columns.some((col) => col.primaryKey);
  const hasTablePk = table.constraints?.some((c) => c.kind === "PRIMARY_KEY_CONSTRAINT");

  if (hasColumnPk || hasTablePk) return;

  context.report({
    level: "error",
    code: "TABLE_NO_PRIMARY_KEY",
    message: `Table "${table.name}" has no primary key.`,
    path: [table.namespace, table.name],
    hint: `Mark a column with .primaryKey() or declare a composite primary key constraint.`,
  });
};

export const unknownColumnReference: TableRule = (table, context) => {
  const columnNames = new Set(table.columns.map((c) => c.name));

  for (const constraint of table.constraints ?? []) {
    if (constraint.kind === "CHECK_CONSTRAINT") continue;

    for (const colName of constraint.columns) {
      if (!columnNames.has(colName)) {
        context.report({
          level: "error",
          code: "UNKNOWN_COLUMN_REFERENCE",
          message: `Constraint "${constraint.name}" on table "${table.name}" references unknown column "${colName}".`,
          path: [table.namespace, table.name, "constraints", constraint.name],
        });
      }
    }

    for (const colName of constraint.include ?? []) {
      if (!columnNames.has(colName)) {
        context.report({
          level: "error",
          code: "UNKNOWN_COLUMN_REFERENCE",
          message: `Constraint "${constraint.name}" on table "${table.name}" includes unknown column "${colName}".`,
          path: [table.namespace, table.name, "constraints", constraint.name],
        });
      }
    }
  }

  for (const index of table.indexes ?? []) {
    for (const ic of index.columns) {
      if (!columnNames.has(ic.column)) {
        context.report({
          level: "error",
          code: "UNKNOWN_COLUMN_REFERENCE",
          message: `Index "${index.name}" on table "${table.name}" references unknown column "${ic.column}".`,
          path: [table.namespace, table.name, "indexes", index.name],
        });
      }
    }

    for (const colName of index.include ?? []) {
      if (!columnNames.has(colName)) {
        context.report({
          level: "error",
          code: "UNKNOWN_COLUMN_REFERENCE",
          message: `Index "${index.name}" on table "${table.name}" includes unknown column "${colName}".`,
          path: [table.namespace, table.name, "indexes", index.name],
        });
      }
    }
  }
};

export const emptyConstraintColumns: TableRule = (table, context) => {
  for (const constraint of table.constraints ?? []) {
    if (constraint.kind === "CHECK_CONSTRAINT") continue;

    if (constraint.columns.length === 0) {
      context.report({
        level: "error",
        code: "EMPTY_CONSTRAINT_COLUMNS",
        message: `Constraint "${constraint.name}" on table "${table.name}" has no columns.`,
        path: [table.namespace, table.name, "constraints", constraint.name],
      });
    }
  }
};

export const tableIdentifiersTooLong: TableRule = (table, context) => {
  for (const column of table.columns) {
    identifierTooLong(column, context);
  }

  for (const index of table.indexes ?? []) {
    identifierTooLong(index, context);
  }

  for (const constraint of table.constraints ?? []) {
    identifierTooLong(constraint, context);
  }
};

function pkColumns(table: ReturnType<AnyTableDefinition["toJSON"]>): string[] | null {
  const tablePk = table.constraints?.find((c) => c.kind === "PRIMARY_KEY_CONSTRAINT");
  if (tablePk) return [...tablePk.columns];

  const columnPk = table.columns.filter((c) => c.primaryKey).map((c) => c.name);
  return columnPk.length > 0 ? columnPk : null;
}

function sameColumnSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((col) => set.has(col));
}

export const redundantUniqueOnPk: TableRule = (table, context) => {
  const pk = pkColumns(table);
  if (!pk) return;

  for (const constraint of table.constraints ?? []) {
    if (constraint.kind !== "UNIQUE_CONSTRAINT") continue;
    if (sameColumnSet(constraint.columns, pk)) {
      context.report({
        level: "warning",
        code: "REDUNDANT_UNIQUE_ON_PK",
        message: `UNIQUE constraint "${constraint.name}" covers the same columns as the primary key.`,
        path: [table.namespace, table.name, "constraints", constraint.name],
      });
    }
  }

  for (const index of table.indexes ?? []) {
    if (!index.unique) continue;
    const cols = index.columns.map((ic) => ic.column);
    if (sameColumnSet(cols, pk)) {
      context.report({
        level: "warning",
        code: "REDUNDANT_UNIQUE_ON_PK",
        message: `Unique index "${index.name}" covers the same columns as the primary key.`,
        path: [table.namespace, table.name, "indexes", index.name],
      });
    }
  }
};

export const duplicateIndexCoverage: TableRule = (table, context) => {
  const indexes = table.indexes ?? [];
  const seen = new Map<string, string>();

  for (const index of indexes) {
    const key = index.columns.map((ic) => ic.column).join(",");
    const prev = seen.get(key);
    if (prev) {
      context.report({
        level: "warning",
        code: "DUPLICATE_INDEX_COVERAGE",
        message: `Index "${index.name}" covers the same columns as index "${prev}".`,
        path: [table.namespace, table.name, "indexes", index.name],
      });
    } else {
      seen.set(key, index.name);
    }
  }
};

export const varcharWithoutLength: TableRule = (table, context) => {
  for (const column of table.columns) {
    if (column.dataType === "varchar") {
      context.report({
        level: "warning",
        code: "VARCHAR_WITHOUT_LENGTH",
        message: `Column "${column.name}" on table "${table.name}" uses varchar without a length modifier.`,
        path: [table.namespace, table.name, "columns", column.name],
        hint: `Prefer varchar(n) with an explicit length, or use text.`,
      });
    }
  }
};
