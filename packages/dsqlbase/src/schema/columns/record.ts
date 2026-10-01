import { ColumnConfig } from "@dsqlbase/core";
import { JsonColumnDefinition } from "./json.js";

/**
 * Defines a record column, stored as `jsonb`: every value is a JSON object at the top level,
 * checked on every write and every read. Type it with `$type<T>()`, exactly as given, or
 * validate it with `.schema()`.
 *
 * In Aurora DSQL a `jsonb` value is limited to 1 MiB compressed, and cannot be indexed.
 *
 * @example
 * ```ts
 * limits: record("limits").$type<Record<string, number>>()
 * limits: record("limits").schema(z.record(z.string(), z.number()))
 * ```
 *
 * @param name Column name in database
 * @returns Serializable column definition for a record column.
 */
export function record<const TName extends string>(name: TName) {
  return new JsonColumnDefinition<TName, ColumnConfig<unknown, unknown, "object">>(
    name,
    { dataType: "jsonb", runtimeType: "object" },
    "object"
  );
}
