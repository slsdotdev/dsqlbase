import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `bytea` data type column in the database schema.
 * @param name Column name in database
 * @returns Serializable column definition for a bytea column.
 */

export function bytea<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<Uint8Array, Buffer>>(name, {
    dataType: "bytea",
    codec: {
      encode: (value) => Buffer.from(value),
      decode: (value) => new Uint8Array(value),
    },
  });
}
