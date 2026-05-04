import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `json` data type column.
 *
 * @param name Column name in database
 * @returns Serializable column definition for a JSON column.
 */

export function json<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<unknown, string>>(name, {
    dataType: "json",
    codec: {
      encode: (value) => JSON.stringify(value),
      decode: (value) => JSON.parse(value),
    },
  });
}
