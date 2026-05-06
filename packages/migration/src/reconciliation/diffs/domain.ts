import { AnyDomainDefinition } from "@dsqlbase/core";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";

export function diffDomain(
  local: SerializedObject<AnyDomainDefinition>,
  remote: SerializedObject<AnyDomainDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnyDomainDefinition>>[] = [];

  for (const key of ["dataType", "notNull", "defaultValue"] as const) {
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
