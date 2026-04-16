import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines an `int` (4 bytes) data type column in the database schema.
 *
 * Range: `-2_147_483_648 to +2_147_483_647`
 * @param name
 * @returns Serializable column definition for an int column.
 */

export function int<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<number, string>>(name, {
    dataType: "int",
    codec: {
      encode: (value) => value.toString(),
      decode: (value) => parseInt(value, 10),
    },
  });
}

export { int as int4 };
