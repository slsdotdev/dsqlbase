import { AnyIndexDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, DiffType, hasDiff, hasUnorderedDiff } from "./base.js";

type IndexKey = { column: string | null; nulls: "FIRST" | "LAST" };

/**
 * Index keys compare in order: a column by its name and NULLS order, an expression only by
 * being one. PostgreSQL prints an expression back deparsed (`lower("email")` reads as
 * `lower(email)`), and comparing that is deferred with CHECK expressions: an expression changed
 * under the same index name isn't detected — rename the index to change it.
 */
function sameKeys(local: readonly IndexKey[], remote: readonly IndexKey[]): boolean {
  return (
    local.length === remote.length &&
    local.every(
      (key, position) =>
        (key.column ?? null) === (remote[position]?.column ?? null) &&
        key.nulls === remote[position]?.nulls
    )
  );
}

export function diffIndex(
  local: SerializedObject<AnyIndexDefinition>,
  remote?: SerializedObject<AnyIndexDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnyIndexDefinition>>[] = [];

  if (!remote) {
    diffs.push({
      type: "add",
      kind: local.kind,
      name: local.name,
      object: local,
    });

    return diffs;
  }

  if (hasDiff(local, remote, "unique")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "unique",
      value: local.unique,
      prevValue: remote.unique,
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

  if (!sameKeys(local.columns, remote.columns)) {
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

  // A predicate compares by presence: PostgreSQL prints it back deparsed (see `sameKeys`).
  if ((local.where == null) !== (remote.where == null)) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "where",
      value: local.where,
      prevValue: remote.where,
    });
  }

  // An async build that failed leaves the index in place, invalid.
  if (hasDiff(local, remote, "valid")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "valid",
      value: local.valid,
      prevValue: remote.valid,
    });
  }

  if (hasUnorderedDiff(local, remote, "include")) {
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
