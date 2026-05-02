import { AnyCheckConstraintDefinition, AnyColumnDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";
import { diffCheckConstraint } from "./constraint.js";

export function diffColumnGenerated(
  local: SerializedObject<AnyColumnDefinition>,
  remote: SerializedObject<AnyColumnDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnyColumnDefinition>>[] = [];

  if (hasDiff(local, remote, "generated")) {
    diffs.push({
      type: diffType(local, remote, "generated"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "generated",
      value: local.generated,
      prevValue: remote.generated,
    });
  }

  return diffs;
}

export function diffColumnIdentity(
  local: SerializedObject<AnyColumnDefinition>,
  remote: SerializedObject<AnyColumnDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnyColumnDefinition>>[] = [];

  if (hasDiff(local, remote, "identity")) {
    diffs.push({
      type: diffType(local, remote, "identity"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "identity",
      value: local.identity,
      prevValue: remote.identity,
    });
  }

  return diffs;
}

export function diffColumnCheck(
  local: SerializedObject<AnyColumnDefinition>,
  remote: SerializedObject<AnyColumnDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>[] = [];

  if (!local.check && !remote.check) {
    return diffs;
  }

  if (local.check) {
    diffs.push(...diffCheckConstraint(local.check, remote.check ?? undefined));
    return diffs;
  }

  if (remote.check) {
    diffs.push({
      type: "remove",
      kind: remote.check.kind,
      name: remote.check.name,
      object: remote.check,
    });
  }

  return diffs;
}

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

  for (const key of [
    "dataType",
    "notNull",
    "defaultValue",
    "domain",
    "primaryKey",
    "unique",
  ] as const) {
    if (hasDiff(local, remote, key)) {
      diffs.push({
        type: diffType(local, remote, key),
        kind: local.kind,
        name: local.name,
        object: local,
        key,
        value: local[key],
        prevValue: remote[key],
      });
    }
  }

  diffs.push(...diffColumnGenerated(local, remote));
  diffs.push(...diffColumnIdentity(local, remote));
  diffs.push(...diffColumnCheck(local, remote));

  return diffs;
}
