import { AnyCheckConstraintDefinition, AnyColumnDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";
import { sameDefault } from "./expression.js";
import { changedSequenceOptions } from "./sequence.js";

type Identity = SerializedObject<AnyColumnDefinition>["identity"];

/**
 * An identity compares by its effective state: its type, its sequence's options with unset ones
 * at their defaults, and its sequence name only when the definition names one — otherwise the
 * database picks it.
 */
function hasIdentityDiff(local: Identity, remote: Identity): boolean {
  if (!local || !remote) {
    return !local !== !remote;
  }

  return (
    local.type !== remote.type ||
    (local.sequenceName != null && local.sequenceName !== remote.sequenceName) ||
    changedSequenceOptions(local.options, remote.options).length > 0
  );
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
    "domain",
    "generated",
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

  if (!sameDefault(local.defaultValue, remote.defaultValue)) {
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

  if (hasIdentityDiff(local.identity, remote.identity)) {
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

  // `check`, `unique` and `primaryKey` are compared with the table's constraints in `diffTable`:
  // the catalog doesn't record whether a constraint was declared on a column or on the table.

  return diffs;
}
