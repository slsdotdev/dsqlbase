import { ColumnConfig } from "@dsqlbase/core";
import { JsonColumnDefinition } from "./json.js";

/**
 * Defines an array column, stored as `jsonb`: every value is a JSON array, checked on every write
 * and every read. Items may be any JSON value; type them with `$type<T>()`, which takes the item
 * type or the array type, or validate the whole array with `.schema()`.
 *
 * In Aurora DSQL a `jsonb` value is limited to 1 MiB compressed, and cannot be indexed.
 *
 * @example
 * ```ts
 * tags: array("tags").$type<string>()                 // string[]
 * tags: array("tags").schema(z.array(z.string()).min(1))
 * ```
 *
 * @param name Column name in database
 * @returns Serializable column definition for an array column.
 */
export function array<const TName extends string>(name: TName) {
  return new JsonColumnDefinition<TName, ColumnConfig<unknown, unknown, "array">>(
    name,
    { dataType: "jsonb", runtimeType: "array" },
    "array"
  );
}
