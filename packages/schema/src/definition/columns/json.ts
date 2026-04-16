import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `json` type column.
 *
 * ### Important Notes
 *
 * The column data type will be `text` in the database, and queries will use pg JSON functions to handle JSON data.
 *
 * This means that while you can store any JSON-serializable data in this column, it will be stored as text and not as a native JSON type.
 *
 * The encoding and decoding functions will handle the conversion between JavaScript objects and JSON strings.
 *
 * @param name Column name in database
 * @returns Serializable column definition for a JSON column.
 */

export function json<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<unknown, string>>(name, {
    dataType: "text",
    codec: {
      encode: (value) => JSON.stringify(value),
      decode: (value) => JSON.parse(value),
    },
  });
}
