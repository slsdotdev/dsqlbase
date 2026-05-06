import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines an `array` **runtime data type** column.
 * #### Important Notes
 *
 * The column data type will be `text` in the database, and queries will use `string_to_array('1,2', ',')` at query execution time to handle array data.
 *
 * This means that while you can store any array of strings in this column, it will be stored as text and not as a native array type.
 *
 * The encoding and decoding functions will handle the conversion between JavaScript arrays and comma-separated strings.
 *
 * @param name Column name in database
 * @returns Serializable column definition for an array column.
 */

export function array<const TName extends string>(name: TName) {
  return new ColumnDefinition<TName, ColumnConfig<string[], string>>(name, {
    dataType: "text",
    codec: {
      encode: (value) => value.join(","),
      decode: (value) => value.split(","),
    },
  });
}
