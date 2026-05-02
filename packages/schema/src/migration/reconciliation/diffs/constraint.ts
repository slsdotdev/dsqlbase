import {
  AnyCheckConstraintDefinition,
  AnyConstraintDefinition,
  AnyPrimaryKeyConstraintDefinition,
  AnyUniqueConstraintDefinition,
} from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, DiffType, hasDiff } from "./base.js";

export type ConstraintDiff =
  | Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>
  | Diff<DiffType, SerializedObject<AnyPrimaryKeyConstraintDefinition>>
  | Diff<DiffType, SerializedObject<AnyUniqueConstraintDefinition>>
  | Diff<DiffType, SerializedObject<AnyConstraintDefinition>>;

export function diffCheckConstraint(
  local: SerializedObject<AnyCheckConstraintDefinition>,
  remote?: SerializedObject<AnyCheckConstraintDefinition>
): Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>[] {
  const diffs: Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>[] = [];

  if (!remote) {
    diffs.push({
      type: "add",
      kind: local.kind,
      name: local.name,
      object: local,
    });

    return diffs;
  }

  if (hasDiff(local, remote, "name")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      key: "name",
      object: local,
      value: local,
      prevValue: remote,
    });
  }

  return diffs;
}

export function diffPrimaryKeyConstraint(
  local: SerializedObject<AnyPrimaryKeyConstraintDefinition>,
  remote?: SerializedObject<AnyPrimaryKeyConstraintDefinition>
): Diff<DiffType, SerializedObject<AnyPrimaryKeyConstraintDefinition>>[] {
  const diffs: Diff<DiffType, SerializedObject<AnyPrimaryKeyConstraintDefinition>>[] = [];

  if (!remote) {
    diffs.push({
      type: "add",
      kind: local.kind,
      name: local.name,
      object: local,
    });

    return diffs;
  }

  if (hasDiff(local, remote, "columns")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "columns",
      value: local.columns,
      prevValue: remote.columns,
    });
  }

  if (hasDiff(local, remote, "include")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "include",
      value: local.include,
      prevValue: remote.include,
    });
  }

  return diffs;
}

export function diffUniqueConstraint(
  local: SerializedObject<AnyUniqueConstraintDefinition>,
  remote?: SerializedObject<AnyUniqueConstraintDefinition>
): Diff<DiffType, SerializedObject<AnyUniqueConstraintDefinition>>[] {
  const diffs: Diff<DiffType, SerializedObject<AnyUniqueConstraintDefinition>>[] = [];

  if (!remote) {
    diffs.push({
      type: "add",
      kind: local.kind,
      name: local.name,
      object: local,
    });

    return diffs;
  }

  if (hasDiff(local, remote, "columns")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "columns",
      value: local.columns,
      prevValue: remote.columns,
    });
  }

  if (hasDiff(local, remote, "include")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "include",
      value: local.include,
      prevValue: remote.include,
    });
  }

  if (hasDiff(local, remote, "distinctNulls")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "distinctNulls",
      value: local.distinctNulls,
      prevValue: remote.distinctNulls,
    });
  }

  return diffs;
}

export function diffConstraint<T extends SerializedObject<AnyConstraintDefinition>>(
  local: T,
  remote?: T
): ConstraintDiff[] {
  const diffs: ConstraintDiff[] = [];

  switch (local.kind) {
    case "CHECK_CONSTRAINT":
      diffs.push(
        ...diffCheckConstraint(local, remote as SerializedObject<AnyCheckConstraintDefinition>)
      );
      break;
    case "PRIMARY_KEY_CONSTRAINT":
      diffs.push(
        ...diffPrimaryKeyConstraint(
          local,
          remote as SerializedObject<AnyPrimaryKeyConstraintDefinition>
        )
      );
      break;
    case "UNIQUE_CONSTRAINT":
      diffs.push(
        ...diffUniqueConstraint(local, remote as SerializedObject<AnyUniqueConstraintDefinition>)
      );
      break;
  }

  return diffs;
}
