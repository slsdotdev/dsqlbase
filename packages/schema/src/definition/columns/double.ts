import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `double precision` (8 bytes) data type column in the database schema.
 *
 * - Precision: 15 decimal digits
 * - Range: `-1.7976931348623157e+308 to +1.7976931348623157e+308`
 *
 * @param name Column name in database
 * @returns Serializable column definition for a double precision column.
 */

export function double<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<number, string>>(name, {
    dataType: "double precision",
    codec: {
      encode: (value) => value.toString(),
      decode: (value) => parseFloat(value),
    },
  });
}

export { double as float8 };
