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
  const remoteConstraints = new Map(
    remote.constraints.map((c: SerializedObject<AnyConstraintDefinition>) => [c.name, c])
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

  for (const localConstraint of local.constraints) {
    const remoteConstraint = remoteConstraints.get(localConstraint.name);

    if (!remoteConstraint || localConstraint.kind === remoteConstraint.kind) {
      diffs.push(...diffConstraint(localConstraint, remoteConstraint));
      remoteConstraints.delete(localConstraint.name);
    }
  }

  for (const remoteConstraint of remoteConstraints.values()) {
    diffs.push({
      type: "remove",
      kind: remoteConstraint.kind,
      name: remoteConstraint.name,
      object: remoteConstraint,
    });
  }

  return diffs;
}
