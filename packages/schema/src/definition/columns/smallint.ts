import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `smallint` (2 bytes) data type column in the database schema.
 *
 * Range: `-32_768 to +32_767`
 * @param name Column name in database
 * @returns Serializable column definition for a smallint column.
 */

export function smallint<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<number, string>>(name, {
    dataType: "smallint",
    codec: {
      encode: (value) => value.toString(),
      decode: (value) => parseInt(value, 10),
    },
  });
}

export { smallint as int2 };
