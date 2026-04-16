import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core/definition";

/**
 * Defines a `text` type column in the database schema.
 *
 * @param name Name of the column in database
 * @returns Serializable column definition for a text column.
 */

export function text<TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<string, string>>(name, {
    dataType: "text",
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });
}
