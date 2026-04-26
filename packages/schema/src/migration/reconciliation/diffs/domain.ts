import { AnyDomainDefinition } from "@dsqlbase/core";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";
import { AnyCheckConstraintDefinition } from "@dsqlbase/core/definition";
import { diffCheckConstraint } from "./constraint.js";

export function diffDomain(
  local: SerializedObject<AnyDomainDefinition>,
  remote: SerializedObject<AnyDomainDefinition>
) {
  const diffs: (
    | Diff<DiffType, SerializedObject<AnyDomainDefinition>>
    | Diff<DiffType, SerializedObject<AnyCheckConstraintDefinition>>
  )[] = [];

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
