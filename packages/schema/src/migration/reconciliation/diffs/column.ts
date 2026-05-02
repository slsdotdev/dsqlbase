import { AnyCheckConstraintDefinition, AnyColumnDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";

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
    "generated",
    "identity",
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

  if (hasDiff(local.check, remote.check, "name")) {
    diffs.push({
      type: diffType(local, remote, "check"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "check",
      value: local.check,
      prevValue: remote.check,
    });
  }

  return diffs;
}
