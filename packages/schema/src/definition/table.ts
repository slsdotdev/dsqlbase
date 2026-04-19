import {
  AnyColumnDefinition,
  SchemaDefinition,
  TableConfig,
  TableDefinition,
} from "@dsqlbase/core/definition";

/**
 * Defines a table schema with specified columns and optional schema association.
 *
 * @param name Table name in the database
 * @param columns An object defining the columns of the table, where keys are field names used at runtime and values are ColumnDefinition instances that specify the column's properties and constraints.
 * @returns A new instance of TableDefinition representing the defined table schema.
 *
 * @example
 *
 * ```ts
 * const users = table("users", {
 *  id: uuid("id").primaryKey(),
 *  name: text("name").notNull(),
 *  email: text("email").unique(),
 * });
 * ```
 */

export function table<TName extends string, TColumns extends Record<string, AnyColumnDefinition>>(
  name: TName,
  columns: TColumns
): TableDefinition<TName, TableConfig<TColumns, SchemaDefinition>> {
  return new TableDefinition(name, { columns });
}
