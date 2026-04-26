import {
  AnyCheckConstraintDefinition,
  AnyColumnDefinition,
  AnyConstraintDefinition,
  AnyIndexDefinition,
  AnyTableDefinition,
} from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";
import { diffCheckConstraint } from "./constraint.js";

export function diffColumn(
  local: SerializedObject<AnyColumnDefinition>,
  remote?: SerializedObject<AnyColumnDefinition>
) {
  const diffs: (
    | Diff<DiffType, SerializedObject<AnyColumnDefinition>>
    | Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>
  )[] = [];

  if (!remote) {
    diffs.push({
      type: "add",
      kind: local.kind,
      name: local.name,
      object: local,
    });

    return diffs;
  }

  if (hasDiff(local, remote, "dataType")) {
    diffs.push({
      type: diffType(local, remote, "dataType"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "dataType",
      value: local.dataType,
      prevValue: remote.dataType,
    });
  }

  if (hasDiff(local, remote, "notNull")) {
    diffs.push({
      type: diffType(local, remote, "notNull"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "notNull",
      value: local.notNull,
      prevValue: remote.notNull,
    });
  }

  if (hasDiff(local, remote, "defaultValue")) {
    diffs.push({
      type: diffType(local, remote, "defaultValue"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "defaultValue",
      value: local.defaultValue,
      prevValue: remote.defaultValue,
    });
  }

  if (hasDiff(local, remote, "domain")) {
    diffs.push({
      type: diffType(local, remote, "domain"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "domain",
      value: local.domain,
      prevValue: remote.domain,
    });
  }

  if (hasDiff(local, remote, "primaryKey")) {
    diffs.push({
      type: diffType(local, remote, "primaryKey"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "primaryKey",
      value: local.primaryKey,
      prevValue: remote.primaryKey,
    });
  }

  if (hasDiff(local, remote, "unique")) {
    diffs.push({
      type: diffType(local, remote, "unique"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "unique",
      value: local.unique,
      prevValue: remote.unique,
    });
  }

  if (local.check && !remote.check) {
    diffs.push({
      type: "add",
      kind: local.check.kind,
      name: local.check.name,
      object: local.check,
    });
  }

  if (!local.check && remote.check) {
    diffs.push({
      type: "remove",
      kind: remote.check.kind,
      name: remote.check.name,
      object: remote.check,
    });
  }

  if (local.check && remote.check) {
    diffs.push(...diffCheckConstraint(local.check, remote.check));
  }

  return diffs;
}

export type TableDiffType =
  | Diff<DiffType, SerializedObject<AnyColumnDefinition>>
  | Diff<DiffType, SerializedObject<AnyIndexDefinition>>
  | Diff<DiffType, SerializedObject<AnyConstraintDefinition>>
  | Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>;

export function diffTable(
  local: SerializedObject<AnyTableDefinition>,
  remote: SerializedObject<AnyTableDefinition>
) {
  const diffs: TableDiffType[] = [];

  const remoteColumns = new Map(
    remote.columns.map((col: SerializedObject<AnyColumnDefinition>) => [col.name, col])
  );

  // const remoteIndexes = new Map(remote.indexes.map((idx) => [idx.name, idx]));
  // const remoteConstraints = new Map(remote.constraints.map((con) => [con.name, con]));

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
    const remoteIndex = remote.indexes.find((idx) => idx.name === localIndex.name);

    if (!remoteIndex) {
      diffs.push({
        type: "add",
        kind: "INDEX",
        name: localIndex.name,
        object: localIndex,
      });

      continue;
    }

    // TBD: Implement index diffing logic.
  }

  for (const remoteIndex of remote.indexes) {
    const localIndex = local.indexes.find((idx) => idx.name === remoteIndex.name);

    if (!localIndex) {
      diffs.push({
        type: "remove",
        kind: "INDEX",
        name: remoteIndex.name,
        object: remoteIndex,
      });
    }
  }

  for (const localConstraint of local.constraints) {
    const remoteConstraint = remote.constraints.find((c) => c.name === localConstraint.name);

    if (!remoteConstraint) {
      diffs.push({
        type: "add",
        kind: localConstraint.kind,
        name: localConstraint.name,
        object: localConstraint,
      });

      continue;
    }

    // TBD: Implement constraint diffing logic.
  }

  for (const remoteConstraint of remote.constraints) {
    const localConstraint = local.constraints.find((c) => c.name === remoteConstraint.name);

    if (!localConstraint) {
      diffs.push({
        type: "remove",
        kind: remoteConstraint.kind,
        name: remoteConstraint.name,
        object: remoteConstraint,
      });
    }
  }

  return diffs;
}
