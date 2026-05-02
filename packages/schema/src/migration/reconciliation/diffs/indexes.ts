import { AnyIndexDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, DiffType, hasDiff } from "./base.js";

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
