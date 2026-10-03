import {
  AnyCheckConstraintDefinition,
  AnyColumnDefinition,
  AnyConstraintDefinition,
  AnyIndexDefinition,
  AnyPrimaryKeyConstraintDefinition,
  AnyTableDefinition,
  AnyUniqueConstraintDefinition,
} from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, DiffType } from "./base.js";
import { diffColumn } from "./column.js";
import { diffConstraint } from "./constraint.js";
import { diffIndex } from "./indexes.js";

export type TableDiffType =
  | Diff<DiffType, SerializedObject<AnyColumnDefinition>>
  | Diff<DiffType, SerializedObject<AnyIndexDefinition>>
  | Diff<DiffType, SerializedObject<AnyConstraintDefinition>>
  | Diff<DiffType, SerializedObject<AnyPrimaryKeyConstraintDefinition>>
  | Diff<DiffType, SerializedObject<AnyUniqueConstraintDefinition>>
  | Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>;

type ConstraintSerialized = SerializedObject<AnyConstraintDefinition>;
type ColumnSerialized = SerializedObject<AnyColumnDefinition>;

/** The name PostgreSQL gives the UNIQUE constraint of a column declared `UNIQUE`. */
export const columnUniqueName = (table: string, column: string) => `${table}_${column}_key`;

/**
 * A table's CHECK and UNIQUE constraints, wherever they were declared: its table-level ones, its
 * columns' CHECKs, and a constraint for each column flagged `unique`. PostgreSQL doesn't record
 * whether a one-column constraint was written on the column or on the table, and introspection
 * can't tell; by name, the two compare the same.
 */
function namedConstraintsOf(table: SerializedObject<AnyTableDefinition>): ConstraintSerialized[] {
  const columns = table.columns as ColumnSerialized[];

  return [
    ...(table.constraints as ConstraintSerialized[]).filter(
      (constraint) => constraint.kind !== "PRIMARY_KEY_CONSTRAINT"
    ),
    ...columns.flatMap((column) => (column.check ? [column.check] : [])),
    ...columns.flatMap((column) =>
      column.unique
        ? [
            {
              kind: "UNIQUE_CONSTRAINT",
              name: columnUniqueName(table.name, column.name),
              columns: [column.name],
              include: null,
              distinctNulls: null,
            } as ConstraintSerialized,
          ]
        : []
    ),
  ];
}

/** The table's primary key, declared on the table or as its columns' `primaryKey` flags. */
function primaryKeyOf(
  table: SerializedObject<AnyTableDefinition>
): SerializedObject<AnyPrimaryKeyConstraintDefinition> | undefined {
  const declared = (table.constraints as ConstraintSerialized[]).find(
    (constraint) => constraint.kind === "PRIMARY_KEY_CONSTRAINT"
  );

  if (declared) {
    return declared as SerializedObject<AnyPrimaryKeyConstraintDefinition>;
  }

  const columns = (table.columns as ColumnSerialized[])
    .filter((column) => column.primaryKey)
    .map((column) => column.name);

  return columns.length > 0
    ? ({
        kind: "PRIMARY_KEY_CONSTRAINT",
        name: `${table.name}_pkey`,
        columns,
        include: null,
      } as SerializedObject<AnyPrimaryKeyConstraintDefinition>)
    : undefined;
}

export function diffTable(
  local: SerializedObject<AnyTableDefinition>,
  remote: SerializedObject<AnyTableDefinition>
) {
  const diffs: TableDiffType[] = [];

  const remoteColumns = new Map(
    remote.columns.map((col: SerializedObject<AnyColumnDefinition>) => [col.name, col])
  );
  const remoteIndexes = new Map(
    remote.indexes.map((idx: SerializedObject<AnyIndexDefinition>) => [idx.name, idx])
  );

  for (const localColumn of local.columns as SerializedObject<AnyColumnDefinition>[]) {
    const remoteColumn = remoteColumns.get(localColumn.name);

    diffs.push(...diffColumn(localColumn, remoteColumn));
    remoteColumns.delete(localColumn.name);
  }

  for (const remoteColumn of remoteColumns.values()) {
    diffs.push({
      type: "remove",
      kind: "COLUMN",
      name: remoteColumn.name,
      object: remoteColumn,
    });
  }

  for (const localIndex of local.indexes) {
    const remoteIndex = remoteIndexes.get(localIndex.name);

    diffs.push(...diffIndex(localIndex, remoteIndex));
    remoteIndexes.delete(localIndex.name);
  }

  for (const remoteIndex of remoteIndexes.values()) {
    diffs.push({
      type: "remove",
      kind: "INDEX",
      name: remoteIndex.name,
      object: remoteIndex,
    });
  }

  // Constraints compare wherever they were declared (see `namedConstraintsOf`): CHECK and
  // UNIQUE by name, the primary key by its columns.
  const remoteNamed = new Map(namedConstraintsOf(remote).map((c) => [c.name, c]));

  for (const localConstraint of namedConstraintsOf(local)) {
    const remoteConstraint = remoteNamed.get(localConstraint.name);

    // A constraint whose kind changed under the same name is a different constraint: the local
    // one is added, and the remote one stays behind to be removed.
    if (remoteConstraint && localConstraint.kind !== remoteConstraint.kind) {
      diffs.push(...diffConstraint(localConstraint, undefined));
      continue;
    }

    diffs.push(...diffConstraint(localConstraint, remoteConstraint));
    remoteNamed.delete(localConstraint.name);
  }

  for (const remoteConstraint of remoteNamed.values()) {
    diffs.push({
      type: "remove",
      kind: remoteConstraint.kind,
      name: remoteConstraint.name,
      object: remoteConstraint,
    });
  }

  const localKey = primaryKeyOf(local);
  const remoteKey = primaryKeyOf(remote);
  const keyColumns = (key?: { columns: readonly string[] }) => key?.columns.join(",") ?? null;

  if (keyColumns(localKey) !== keyColumns(remoteKey)) {
    const object = localKey ?? remoteKey;

    if (object) {
      diffs.push(
        localKey && remoteKey
          ? {
              type: "modify",
              kind: object.kind,
              name: object.name,
              object,
              key: "columns",
              value: localKey.columns,
              prevValue: remoteKey.columns,
            }
          : { type: localKey ? "add" : "remove", kind: object.kind, name: object.name, object }
      );
    }
  }

  return diffs;
}
