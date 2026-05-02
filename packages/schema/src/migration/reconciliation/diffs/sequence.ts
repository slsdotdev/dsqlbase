import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, DiffType, hasDiff } from "./base.js";

export function diffSequence(
  local: SerializedObject<AnySequenceDefinition>,
  remote: SerializedObject<AnySequenceDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnySequenceDefinition>>[] = [];

  if (hasDiff(local, remote, "options")) {
    diffs.push({
      type: "modify",
      kind: local.kind,
      name: local.name,
      object: local,
      key: "options",
      value: local.options,
      prevValue: remote.options,
    });
  }

  return diffs;
}
