import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { Diff, DiffType } from "./base.js";

type SequenceOptions = NonNullable<SerializedObject<AnySequenceDefinition>["options"]>;

/** The options a sequence's state is compared by. `ownedBy` is not: its serialization is deferred. */
export const COMPARED_SEQUENCE_OPTIONS = [
  "dataType",
  "increment",
  "minValue",
  "maxValue",
  "startValue",
  "cache",
  "cycle",
] as const;

export type ComparedSequenceOption = (typeof COMPARED_SEQUENCE_OPTIONS)[number];

// Read back through `Number`, as introspection reads every bound: equal floats, not exact bigints.
const BIGINT_MAX = Number("9223372036854775807");
const BIGINT_MIN = Number("-9223372036854775808");

/**
 * The options as the database applies them: an option the definition leaves unset takes the
 * PostgreSQL default for a `bigint` sequence (the only type DSQL supports), which is what
 * introspection reads back. Without it, every unset bound re-plans as a change.
 */
export function effectiveSequenceOptions(
  options: Partial<SequenceOptions> | null | undefined
): Pick<Required<SequenceOptions>, ComparedSequenceOption> {
  const increment = options?.increment ?? 1;
  const ascending = increment > 0;
  const minValue = options?.minValue ?? (ascending ? 1 : BIGINT_MIN);
  const maxValue = options?.maxValue ?? (ascending ? BIGINT_MAX : -1);

  return {
    dataType: options?.dataType ?? "bigint",
    increment,
    minValue,
    maxValue,
    startValue: options?.startValue ?? (ascending ? minValue : maxValue),
    cache: options?.cache ?? 1,
    cycle: options?.cycle ?? false,
  };
}

/** The options whose effective values differ, in a stable order. */
export function changedSequenceOptions(
  local: Partial<SequenceOptions> | null | undefined,
  remote: Partial<SequenceOptions> | null | undefined
): ComparedSequenceOption[] {
  const a = effectiveSequenceOptions(local);
  const b = effectiveSequenceOptions(remote);

  return COMPARED_SEQUENCE_OPTIONS.filter((key) => a[key] !== b[key]);
}

export function diffSequence(
  local: SerializedObject<AnySequenceDefinition>,
  remote: SerializedObject<AnySequenceDefinition>
) {
  const diffs: Diff<DiffType, SerializedObject<AnySequenceDefinition>>[] = [];

  if (changedSequenceOptions(local.options, remote.options).length > 0) {
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
