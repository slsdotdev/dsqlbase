import type { AnyColumn, ColumnRuntimeType } from "@dsqlbase/core";

/**
 * What a column of each runtime type can be filtered and ordered by. The filter types in
 * `base.ts` are written from the same table, and the normalizer enforces it, so an operator the
 * types refuse is also refused at runtime — before any SQL is built.
 */

const COMPARISON = ["eq", "neq", "in", "gt", "gte", "lt", "lte", "between", "exists"] as const;
const PATTERN = ["beginsWith", "endsWith", "contains"] as const;

export type FilterOperator = (typeof COMPARISON)[number] | (typeof PATTERN)[number];

export type RuntimeTypeRules = {
  /** The operators a filter on the column may use. */
  operators: readonly FilterOperator[];
  /** Whether a bare value stands for `{ eq: value }`. */
  shorthand: boolean;
  /** Whether the column can be an `orderBy` key. */
  orderable: boolean;
  /** Whether the database can compare two values for equality, which `distinct` needs. */
  distinct: boolean;
};

const comparable: RuntimeTypeRules = {
  operators: COMPARISON,
  shorthand: true,
  orderable: true,
  distinct: true,
};
const document: RuntimeTypeRules = {
  operators: ["exists"],
  shorthand: false,
  orderable: false,
  distinct: true,
};

/**
 * `jsonb` equality and containment. `contains` means `@>` here, not `LIKE`: the value is a
 * fragment of a document, matched recursively.
 */
const jsonbDocument: RuntimeTypeRules = {
  ...document,
  operators: ["eq", "neq", "contains", "exists"],
};

export const RUNTIME_TYPE_RULES: Readonly<Record<ColumnRuntimeType, RuntimeTypeRules>> = {
  string: { ...comparable, operators: [...COMPARISON, ...PATTERN] },
  uuid: comparable,
  number: comparable,
  bigint: comparable,
  date: comparable,
  interval: comparable,
  boolean: { ...comparable, operators: ["eq", "neq", "exists"] },
  bytes: document,
  // `json` has no equality operator at all.
  json: { ...document, distinct: false },
  jsonb: jsonbDocument,
  array: document,
  object: document,
};

/** Every operator any runtime type accepts — what tells an operator object from a value. */
export const FILTER_OPERATORS: ReadonlySet<string> = new Set<string>([...COMPARISON, ...PATTERN]);

/**
 * Inside a column's filter, `where` is reserved for filtering into the column's value — a
 * document's keys, later an embedded object's members. Reserved so that no operator takes the
 * name; not supported yet.
 */
export const NESTED_FILTER = "where";

/** The runtime types stored as `jsonb`, where `contains` is containment (`@>`). */
export const JSONB_RUNTIME_TYPES: ReadonlySet<ColumnRuntimeType> = new Set(["jsonb"]);

export function rulesOf(column: AnyColumn): RuntimeTypeRules {
  return RUNTIME_TYPE_RULES[column.runtimeType];
}

/* -------------------------------------------------------------------------------------------
 * The same table, at type level
 * ---------------------------------------------------------------------------------------- */

/** The operators a runtime type accepts. Mirrors {@link RUNTIME_TYPE_RULES}. */
export type OperatorsOf<R extends ColumnRuntimeType> = R extends "string"
  ? FilterOperator
  : R extends "uuid" | "number" | "bigint" | "date" | "interval"
    ? (typeof COMPARISON)[number]
    : R extends "boolean"
      ? "eq" | "neq" | "exists"
      : R extends JsonbRuntimeType
        ? "eq" | "neq" | "contains" | "exists"
        : "exists";

/** The runtime types stored as `jsonb`. Mirrors {@link JSONB_RUNTIME_TYPES}. */
export type JsonbRuntimeType = "jsonb";

/**
 * What `contains` takes on runtime type `R` holding `V`: a substring on `string`, a fragment of
 * the document on a `jsonb` type — never `null`, and anything on an untyped document.
 */
export type ContainsValueOf<R extends ColumnRuntimeType, V> = R extends "string"
  ? string
  : R extends JsonbRuntimeType
    ? unknown extends V
      ? unknown
      : JsonFragment<NonNullable<V>>
    : never;

/**
 * A part of a JSON value, as `@>` matches it: any object member may be left out, at any depth,
 * and an array lists some of its items.
 */
export type JsonFragment<T> = T extends Date
  ? T
  : T extends readonly (infer I)[]
    ? JsonFragment<I>[]
    : T extends object
      ? { [K in keyof T]?: JsonFragment<T[K]> }
      : T;

/** The runtime types where a bare value stands for `{ eq: value }`. */
export type ShorthandRuntimeType =
  | "string"
  | "uuid"
  | "number"
  | "bigint"
  | "date"
  | "interval"
  | "boolean";

/** The runtime types a column can be ordered by. */
export type OrderableRuntimeType = ShorthandRuntimeType;
