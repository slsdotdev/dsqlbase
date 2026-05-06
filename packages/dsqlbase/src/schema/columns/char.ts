import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core/definition";

/**
 * Defines a `char(n)` type column in the database schema.
 *
 * @param name Name of the column in database
 * @param length Fixed length of the char field
 * @returns Serializable column definition for a char column.
 */

export function char<const TName extends string, const TLength extends number>(
  name: TName,
  length: TLength
) {
  return new ColumnDefinition<TName, ColumnConfig<string, string>>(name, {
    dataType: `char(${length})`,
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });
}
