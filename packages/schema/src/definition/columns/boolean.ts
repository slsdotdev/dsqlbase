import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `boolean` type column in the database schema.
 *
 * @param name Column name in database
 * @returns Serializable column definition for a boolean column.
 */

export function boolean<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<boolean, boolean>>(name, {
    dataType: "boolean",
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });
}

export { boolean as bool };
