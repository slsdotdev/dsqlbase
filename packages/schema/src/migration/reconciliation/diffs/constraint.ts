import { AnyCheckConstraintDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";

export function diffCheckConstraint(
  local: SerializedObject<AnyCheckConstraintDefinition>,
  remote: SerializedObject<AnyCheckConstraintDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>[] = [];

  if (hasDiff(local, remote, "name")) {
    diffs.push({
      type: diffType(local, remote, "name"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "name",
      value: local,
      prevValue: remote,
    });
  }

  return diffs;
}
