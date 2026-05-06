import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `bigint` (8 bytes) data type column in the database schema.
 *
 * Range: `-9_223_372_036_854_775_808 to +9_223_372_036_854_775_807`
 * @param name Column name in database
 * @returns Serializable column definition for a bigint column.
 */

export function bigint<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<bigint, string>>(name, {
    dataType: "bigint",
    codec: {
      encode: (value) => value.toString(),
      decode: (value) => BigInt(value),
    },
  });
}

export { bigint as int8 };
