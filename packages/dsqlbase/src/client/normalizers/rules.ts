import { AnyColumn } from "@dsqlbase/core";
import { ColumnRuntimeType } from "@dsqlbase/core/definition";

export const COMPARISON = [
  "eq",
  "neq",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "exists",
] as const;
export const PATTERN = ["beginsWith", "endsWith", "contains"] as const;
export const NESTED = ["hasKey", "where"] as const;

export type FilterOperator =
  | (typeof COMPARISON)[number]
  | (typeof PATTERN)[number]
  | (typeof NESTED)[number];

export type ColumnRules = {
  /** The operators a filter on the column may use. */
  operators: readonly FilterOperator[];
  /** Whether a bare value stands for `{ eq: value }`. */
  shorthand: boolean;
  /** Whether the column can be an `orderBy` key. */
  orderable: boolean;
  /** Whether the database can compare two values for equality, which `distinct` needs. */
  distinct: boolean;
};

export const comparable = {
  operators: COMPARISON,
  shorthand: true,
  orderable: true,
  distinct: true,
} as const satisfies ColumnRules;

export const document = {
  operators: ["exists"],
  shorthand: false,
  orderable: false,
  distinct: true,
} as const satisfies ColumnRules;

/**
 * `jsonb` equality and containment. `contains` means `@>` here, not `LIKE`: the value is a
 * fragment of a document, matched recursively.
 */
export const jsonbDocument = {
  ...document,
  operators: ["eq", "neq", "contains", "exists"],
} as const satisfies ColumnRules;

export const RUNTIME_COLUMN_RULES = {
  string: { ...comparable, operators: [...COMPARISON, ...PATTERN] },
  uuid: { ...comparable, operators: ["eq", "neq", "in", "exists"] },
  number: comparable,
  bigint: comparable,
  date: comparable,
  interval: comparable,
  boolean: { ...comparable, operators: ["eq", "neq", "exists"] },
  bytes: document,
  // `json` has no equality operator at all.
  json: { ...document, distinct: false },
  jsonb: jsonbDocument,
  array: jsonbDocument,
  object: { ...jsonbDocument, operators: [...jsonbDocument.operators, ...NESTED] },
} as const satisfies Record<ColumnRuntimeType, ColumnRules>;

/** Every operator any runtime type accepts — what tells an operator object from a value. */
export const FILTER_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...COMPARISON,
  ...PATTERN,
  ...NESTED,
]);

/** The runtime types stored as `jsonb`, where `contains` is containment (`@>`). */
export const JSONB_RUNTIME_TYPES: ReadonlySet<ColumnRuntimeType> = new Set([
  "jsonb",
  "array",
  "object",
]);

/** The runtime types whose values can be plain objects: a `Duration`, a JSON document. */
export const PLAIN_OBJECT_VALUES: ReadonlySet<ColumnRuntimeType> = new Set([
  "interval",
  "json",
  "jsonb",
  "object",
]);

export type RuntimeColumnRules = typeof RUNTIME_COLUMN_RULES;

export type ShorthandRuntimeType<T extends ColumnRuntimeType> = T extends keyof RuntimeColumnRules
  ? RuntimeColumnRules[T]["shorthand"]
  : never;

export type OrderableRuntimeType = {
  [K in keyof RuntimeColumnRules]: RuntimeColumnRules[K]["orderable"] extends true ? K : never;
}[keyof RuntimeColumnRules];

/** The operators a runtime type accepts. Mirrors {@link RUNTIME_FILTER_RULES}. */
export type OperatorsOf<R extends ColumnRuntimeType> = R extends keyof RuntimeColumnRules
  ? RuntimeColumnRules[R]["operators"][number]
  : never;

export function getColumnRules<T extends AnyColumn>(
  column: T
): RuntimeColumnRules[T["runtimeType"]] {
  return RUNTIME_COLUMN_RULES[column.runtimeType] as RuntimeColumnRules[T["runtimeType"]];
}

export const isFilterObject = (condition: unknown): condition is Record<string, unknown> => {
  if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
    return false;
  }

  return Object.keys(condition).some(
    (key) => FILTER_OPERATORS.has(key) || NESTED.includes(key as (typeof NESTED)[number])
  );
};

export const isRuleOperator = (
  rule: ColumnRules,
  operator: string
): operator is (typeof rule)["operators"][number] =>
  rule.operators.includes(operator as FilterOperator);

export const isNestedFilter = (key: string): boolean =>
  NESTED.includes(key as (typeof NESTED)[number]);

export function allowPlainObjectFilter(column: AnyColumn): boolean {
  return PLAIN_OBJECT_VALUES.has(column.runtimeType);
}
