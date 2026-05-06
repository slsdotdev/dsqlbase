import { NamespaceDefinition } from "@dsqlbase/core";

/**
 * Creates a namespace definition.
 * A namespace is a logical grouping of database objects, such as tables, views, and sequences.
 * It helps to organize and manage database objects within a schema.
 * @example
 * ```ts
 * const myNamespace = namespace("my_schema");
 *
 * const usersTable = myNamespace.table("users", {
 *   id: uuid("id").primaryKey(),
 *   name: text("name").notNull(),
 * });
 *
 * const userIdSequence = myNamespace.sequence("user_id_seq");
 * ```
 * @param name The name of the namespace.
 * @returns A new NamespaceDefinition instance.
 */

export function namespace<const TName extends string>(name: TName) {
  return new NamespaceDefinition<TName>(name);
}

export { namespace as schema };
