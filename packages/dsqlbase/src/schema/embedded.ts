import { EmbeddedObjectDefinition, TableColumnDefinitions } from "@dsqlbase/core/definition";

/**
 * Defines a reusable value object — `Money`, `Address` — that tables embed as real columns.
 *
 * `.column(name)` places it in a table as a column group: one column per member, named
 * `<name>_<member>`, each keeping its own type, codec, validator and `.notNull()`. A member may
 * be another group, which chains the prefix. The group is read and written as one nested
 * object, and its members can be indexed and constrained like any column.
 *
 * A group has no nullability of its own: it can be `null` only when every member is nullable,
 * and is `null` when all of them are. Members cannot be primary keys or tenant claims.
 *
 * @param columns The members, keyed by field name.
 *
 * @example
 * ```ts
 * export const money = embedded({
 *   amount: bigint("amount").notNull(),
 *   currency: text("currency").notNull().default("EUR"),
 * });
 *
 * export const invoices = table("invoices", {
 *   id: uuid("id").primaryKey().defaultRandom(),
 *   netValue: money.column("net_value"), // net_value_amount, net_value_currency
 * });
 *
 * invoices.index("invoices_net_value_idx").columns((c) => [c.netValue.amount]);
 * ```
 */
export function embedded<TColumns extends TableColumnDefinitions>(
  columns: TColumns
): EmbeddedObjectDefinition<TColumns> {
  return new EmbeddedObjectDefinition(columns);
}
