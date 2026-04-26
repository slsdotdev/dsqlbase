import {
  AnyColumnDefinition,
  AnyConstraintDefinition,
  AnyIndexDefinition,
  AnyTableDefinition,
  DefinitionNode,
} from "@dsqlbase/core/definition";
import { SerializedObject } from "../base.js";

export type DiffType = "add" | "remove" | "modify";
export type DiffValue<
  TType extends DiffType,
  TObject extends SerializedObject<DefinitionNode>,
> = TType extends "modify"
  ? TObject[keyof TObject] extends (infer V)[]
    ? V
    : TObject[keyof TObject]
  : TObject;

export interface Diff<TType extends DiffType, TObject extends SerializedObject<DefinitionNode>> {
  type: TType;
  kind: TObject["kind"];
  name: TObject["name"];
  object: TObject;
  key?: keyof TObject;
  value?: DiffValue<TType, TObject>;
  prevValue?: DiffValue<TType, TObject>;
}

function hasDiff<T extends SerializedObject<DefinitionNode>>(
  local: T | null | undefined,
  remote: T | null | undefined,
  key: keyof T
): boolean {
  return local?.[key] !== remote?.[key];
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function diffType<T extends SerializedObject<DefinitionNode>>(
  local: T,
  remote: T,
  key: keyof T
): DiffType {
  if (isSet(local[key]) && !isSet(remote[key])) {
    return "add";
  }

  if (!isSet(local[key]) && isSet(remote[key])) {
    return "remove";
  }

  return "modify";
}

export function diffColumn(
  local: SerializedObject<AnyColumnDefinition>,
  remote: SerializedObject<AnyColumnDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnyColumnDefinition>>[] = [];

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

  return diffs;
}

export type TableDiffType =
  | Diff<DiffType, SerializedObject<AnyColumnDefinition>>
  | Diff<DiffType, SerializedObject<AnyIndexDefinition>>
  | Diff<DiffType, SerializedObject<AnyConstraintDefinition>>;

export function diffTable(
  local: SerializedObject<AnyTableDefinition>,
  remote: SerializedObject<AnyTableDefinition>
) {
  const diffs: TableDiffType[] = [];

  for (const localColumn of local.columns as SerializedObject<AnyColumnDefinition>[]) {
    const remoteColumn = remote.columns.find((col) => col.name === localColumn.name);

    if (!remoteColumn) {
      diffs.push({
        type: "add",
        kind: "COLUMN",
        name: localColumn.name,
        object: localColumn,
      });

      continue;
    }

    diffs.push(...diffColumn(localColumn, remoteColumn));
  }

  for (const remoteColumn of remote.columns as SerializedObject<AnyColumnDefinition>[]) {
    const localColumn = local.columns.find((col) => col.name === remoteColumn.name);

    if (!localColumn) {
      diffs.push({
        type: "remove",
        kind: "COLUMN",
        name: remoteColumn.name,
        object: remoteColumn,
      });
    }
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
