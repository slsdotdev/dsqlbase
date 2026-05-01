import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, DiffType } from "./base.js";

// TODO(story-3): per-field sequence option diffing. Today this collapses every options change into one diff.

export function diffSequence(
  local: SerializedObject<AnySequenceDefinition>,
  remote: SerializedObject<AnySequenceDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnySequenceDefinition>>[] = [];

  if (JSON.stringify(local.options) !== JSON.stringify(remote.options)) {
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
