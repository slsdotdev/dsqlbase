import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `real` (4 bytes) data type column in the database schema.
 *
 * - Precision: 6 decimal digits
 * - Range: `-3.4028235e+38 to +3.4028235e+38`
 *
 * @param name Column name in database
 * @returns Serializable column definition for a real column.
 */
export function real<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<number, string>>(name, {
    dataType: "real",
    codec: {
      encode: (value) => value.toString(),
      decode: (value) => parseFloat(value),
    },
  });
}

export { real as float4 };
