import {
  AnyColumnDefinition,
  AnyConstraintDefinition,
  AnyIndexDefinition,
  AnyTableDefinition,
} from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { ddl } from "../../ddl/index.js";
import { namedConstraintsOf } from "../diffs/table.js";
import {
  change,
  DDLOperation,
  DDLOperationError,
  DraftOperation,
  maybeNamespaceReference,
  qualifiedName,
  schemaOf,
  refusal,
} from "./base.js";

type Table = SerializedObject<AnyTableDefinition>;
type Column = SerializedObject<AnyColumnDefinition>;
type Constraint = SerializedObject<AnyConstraintDefinition>;
type Index = SerializedObject<AnyIndexDefinition>;

export type RenameResult = {
  operations: DDLOperation[];
  errors: DDLOperationError[];
  /** The database's table as it will be once the renames ran: what the rest is diffed against. */
  remote: Table;
};

const NOT_ZERO_DOWNTIME =
  "not zero-downtime: code still using the old name fails until the new code is deployed";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A table renamed with `table(...).renamedFrom(previous)`: `ALTER TABLE previous RENAME TO
 * name`, when the database has the previous name and not the new one. `undefined` when there's
 * nothing to rename — the hint is inert once the database has the new name.
 */
export function renameTable(
  local: Table,
  remote: Table | undefined,
  existing: Table | undefined
): RenameResult | { error: DDLOperationError } | undefined {
  const previous = local.renamedFrom;

  if (!previous || !remote) return undefined;

  if (existing) {
    return {
      error: refusal({
        code: "RENAME_CONFLICT",
        message:
          `Table "${local.name}" is renamed from "${previous}", but both exist. Drop or rename ` +
          `one of them first, or remove the hint.`,
        object: local,
        subject: local.name,
        summary: {
          subject: { kind: "TABLE", name: qualifiedName(local) },
          action: "RENAME",
          changes: [{ attribute: "name", from: previous, to: local.name }],
        },
      }),
    };
  }

  const subject = { kind: "TABLE", name: qualifiedName(local) } as const;
  const tableRename: DraftOperation = {
    type: "ALTER",
    object: local,
    statement: ddl.alterTable({
      name: previous,
      schema: schemaOf(local),
      actions: [ddl.rename({ newName: local.name })],
    }),
    references: maybeNamespaceReference(local),
    summary: {
      subject,
      action: "RENAME",
      changes: [{ attribute: "name", from: previous, to: local.name }],
      risk: "safe",
      note: NOT_ZERO_DOWNTIME,
    },
  };

  const renamed = { ...remote, name: local.name } as Table;
  // `<previous>_…` becomes `<name>_…`, and a column renamed in the same definition is renamed in
  // it too: `users_name_key` → `people_full_name_key`.
  const columnRenames = (local.columns as Column[]).flatMap((column) =>
    column.renamedFrom
      ? [[new RegExp(`(^|_)${escapeRegExp(column.renamedFrom)}(_|$)`), column.name] as const]
      : []
  );
  const derived = derivedRenames(local, renamed, (name) =>
    name.startsWith(`${previous}_`)
      ? columnRenames.reduce(
          (next, [pattern, column]) => next.replace(pattern, `$1${column}$2`),
          `${local.name}_${name.slice(previous.length + 1)}`
        )
      : null
  );

  return {
    operations: change(`${qualifiedName(local)} (rename)`, [
      tableRename,
      ...derivedDrafts(local, subject, derived),
    ]),
    errors: [],
    remote: applyRenames(renamed, derived),
  };
}

/**
 * The columns renamed with `.renamedFrom(previous)`: `RENAME COLUMN`, when the database has the
 * previous name and not the new one, with the constraints and indexes named after it.
 */
export function renameColumns(local: Table, remote: Table): RenameResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];
  const remoteColumns = new Set((remote.columns as Column[]).map((column) => column.name));
  const subject = { kind: "TABLE", name: qualifiedName(local) } as const;
  let current = remote;

  for (const column of local.columns as Column[]) {
    const previous = column.renamedFrom;

    if (!previous || !remoteColumns.has(previous)) continue;

    if (remoteColumns.has(column.name)) {
      errors.push(
        refusal({
          code: "RENAME_CONFLICT",
          message:
            `Column "${column.name}" is renamed from "${previous}", but both exist on ` +
            `"${local.name}". Drop or rename one of them first, or remove the hint.`,
          object: column,
          subject: column.name,
          summary: {
            subject,
            action: "RENAME",
            target: { kind: "COLUMN", name: column.name },
            changes: [{ attribute: "name", from: previous, to: column.name }],
          },
        })
      );
      continue;
    }

    const pattern = new RegExp(`(^|_)${escapeRegExp(previous)}(_|$)`);
    const withColumn = renameColumnIn(current, previous, column.name);
    const derived = derivedRenames(local, withColumn, (name) =>
      pattern.test(name) ? name.replace(pattern, `$1${column.name}$2`) : null
    );

    operations.push(
      ...change(`${qualifiedName(local)}.${column.name} (rename)`, [
        {
          type: "ALTER",
          object: local,
          statement: ddl.alterTable({
            name: local.name,
            schema: schemaOf(local),
            actions: [ddl.renameColumn({ columnName: previous, newName: column.name })],
          }),
          references: maybeNamespaceReference(local),
          summary: {
            subject,
            action: "RENAME",
            target: { kind: "COLUMN", name: column.name },
            changes: [{ attribute: "name", from: previous, to: column.name }],
            risk: "safe",
            note: NOT_ZERO_DOWNTIME,
          },
        },
        ...derivedDrafts(local, subject, derived),
      ])
    );

    current = applyRenames(withColumn, derived);
  }

  return { operations, errors, remote: current };
}

type DerivedRenames = { constraints: [string, string][]; indexes: [string, string][] };

/**
 * The constraints and indexes named after a renamed table or column — `<table>_<column>_key`,
 * `<column>_check`, `<table>_<column>_not_null` — whose new name the definition has and the
 * database doesn't. Renamed with their owner, they stay as they are instead of being dropped
 * and created again.
 */
function derivedRenames(
  local: Table,
  remote: Table,
  rename: (name: string) => string | null
): DerivedRenames {
  const localNames = new Set([
    ...namedConstraintsOf(local).map((constraint) => constraint.name),
    ...local.indexes.map((index: Index) => index.name),
  ]);
  const remoteConstraints = namedConstraintsOf(remote).map((constraint) => constraint.name);
  const remoteIndexes = remote.indexes.map((index: Index) => index.name);
  const remoteNames = new Set([...remoteConstraints, ...remoteIndexes]);

  const pairs = (names: string[]) =>
    names.flatMap((name): [string, string][] => {
      const next = rename(name);
      return next &&
        next !== name &&
        localNames.has(next) &&
        !localNames.has(name) &&
        !remoteNames.has(next)
        ? [[name, next]]
        : [];
    });

  return { constraints: pairs(remoteConstraints), indexes: pairs(remoteIndexes) };
}

function derivedDrafts(
  local: Table,
  subject: { kind: "TABLE"; name: string },
  derived: DerivedRenames
): DraftOperation[] {
  return [
    ...derived.constraints.map(
      ([from, to]): DraftOperation => ({
        type: "ALTER",
        object: local,
        statement: ddl.alterTable({
          name: local.name,
          schema: schemaOf(local),
          actions: [ddl.renameConstraint({ constraintName: from, newName: to })],
        }),
        references: maybeNamespaceReference(local),
        summary: {
          subject,
          action: "RENAME",
          target: { kind: "CONSTRAINT", name: to },
          changes: [{ attribute: "name", from, to }],
          risk: "safe",
        },
      })
    ),
    ...derived.indexes.map(
      ([from, to]): DraftOperation => ({
        type: "ALTER",
        object: local,
        statement: ddl.alterIndex({
          name: from,
          schema: schemaOf(local),
          action: ddl.rename({ newName: to }),
        }),
        references: maybeNamespaceReference(local),
        summary: {
          subject,
          action: "RENAME",
          target: { kind: "INDEX", name: to },
          changes: [{ attribute: "name", from, to }],
          risk: "safe",
        },
      })
    ),
  ];
}

/** The table with a column renamed, everywhere it is named: indexes and constraints included. */
function renameColumnIn(table: Table, from: string, to: string): Table {
  const swap = (name: string) => (name === from ? to : name);
  const swapAll = (names: readonly string[] | null) => (names ? names.map(swap) : names);

  return {
    ...table,
    columns: (table.columns as Column[]).map((column) =>
      column.name === from ? { ...column, name: to } : column
    ),
    indexes: table.indexes.map((index: Index) => ({
      ...index,
      columns: index.columns.map((key) =>
        key.column === from ? { ...key, column: to, name: `${index.name}_column_${to}` } : key
      ),
      include: swapAll(index.include),
    })),
    constraints: (table.constraints as Constraint[]).map((constraint) =>
      "columns" in constraint
        ? {
            ...constraint,
            columns: swapAll(constraint.columns),
            include: swapAll(constraint.include),
          }
        : constraint
    ),
  } as Table;
}

/** The table with constraints and indexes renamed. */
function applyRenames(table: Table, derived: DerivedRenames): Table {
  const constraints = new Map(derived.constraints);
  const indexes = new Map(derived.indexes);
  const renameConstraint = <T extends { name: string }>(constraint: T): T =>
    constraints.has(constraint.name)
      ? { ...constraint, name: constraints.get(constraint.name) as string }
      : constraint;

  return {
    ...table,
    columns: (table.columns as Column[]).map((column) =>
      column.check ? { ...column, check: renameConstraint(column.check) } : column
    ),
    indexes: table.indexes.map((index: Index) =>
      indexes.has(index.name) ? { ...index, name: indexes.get(index.name) as string } : index
    ),
    constraints: (table.constraints as Constraint[]).map(renameConstraint),
  } as Table;
}
