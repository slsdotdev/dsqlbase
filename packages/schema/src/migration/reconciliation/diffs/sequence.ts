import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, diffType, DiffType, hasDiff } from "./base.js";

export function diffSequence(
  local: SerializedObject<AnySequenceDefinition>,
  remote: SerializedObject<AnySequenceDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnySequenceDefinition>>[] = [];

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

  if (hasDiff(local, remote, "cache")) {
    diffs.push({
      type: diffType(local, remote, "cache"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "cache",
      value: local.cache,
      prevValue: remote.cache,
    });
  }

  if (hasDiff(local, remote, "cycle")) {
    diffs.push({
      type: diffType(local, remote, "cycle"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "cycle",
      value: local.cycle,
      prevValue: remote.cycle,
    });
  }

  if (hasDiff(local, remote, "increment")) {
    diffs.push({
      type: diffType(local, remote, "increment"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "increment",
      value: local.increment,
      prevValue: remote.increment,
    });
  }

  if (hasDiff(local, remote, "maxValue")) {
    diffs.push({
      type: diffType(local, remote, "maxValue"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "maxValue",
      value: local.maxValue,
      prevValue: remote.maxValue,
    });
  }

  if (hasDiff(local, remote, "minValue")) {
    diffs.push({
      type: diffType(local, remote, "minValue"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "minValue",
      value: local.minValue,
      prevValue: remote.minValue,
    });
  }

  if (hasDiff(local, remote, "ownedBy")) {
    diffs.push({
      type: diffType(local, remote, "ownedBy"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "ownedBy",
      value: local.ownedBy,
      prevValue: remote.ownedBy,
    });
  }

  if (hasDiff(local, remote, "startValue")) {
    diffs.push({
      type: diffType(local, remote, "startValue"),
      kind: local.kind,
      name: local.name,
      object: local,
      key: "startValue",
      value: local.startValue,
      prevValue: remote.startValue,
    });
  }

  return diffs;
}
