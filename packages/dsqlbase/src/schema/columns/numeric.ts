import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `numeric` (variable precision) data type column in the database schema.
 *
 * - Precision: Exact numeric of selectable precision. The maximum precision is 38 and the maximum scale is 37.
 * @param name Column name in database
 * @returns Serializable column definition for a numeric column.
 */

export function numeric<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<number, string>>(name, {
    dataType: "numeric",
    codec: {
      encode: (value) => value.toString(),
      decode: (value) => parseFloat(value),
    },
  });
}

export { numeric as decimal };
