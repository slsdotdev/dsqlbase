import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

/**
 * Defines a `varchar(n)` type column in the database schema.
 * @param name Name of the column in database
 * @param length Maximum length of the varchar field
 * @returns Serializable column definition for a varchar column.
 */

export function varchar<const TName extends string, const TLength extends number>(
  name: TName,
  length: TLength
) {
  return new ColumnDefinition<TName, ColumnConfig<string, string>>(name, {
    dataType: `varchar(${length})`,
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });
}
