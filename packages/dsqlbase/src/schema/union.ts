import {
  AnyUnionMembers,
  UnionColumnsConfig,
  UnionConfig,
  UnionDefinition,
} from "@dsqlbase/core/definition";

/**
 * Defines a set of tables that can stand in for one another — a GraphQL union or interface.
 *
 * Key every member by the alias it is exported under in the schema; the client refuses any
 * other key when it is built. The second argument declares the fields that work across the
 * union — a relation's `to`, and shared `select` / `where` / `orderBy` — as `union.columns`.
 * Each is the column every member stores under the same field: the same database name and
 * type, and `NOT NULL` on every member when it is declared so. A union produces no DDL.
 *
 * @param members The member tables, keyed by schema alias.
 * @param columns The shared fields, keyed by field name, each declared as its column.
 *
 * @example
 * ```ts
 * export const photos = table("photos", { id: guid("id").primaryKey(), userId: guid("user_id") });
 * export const videos = table("videos", { id: guid("id").primaryKey(), userId: guid("user_id") });
 *
 * export const posts = union("posts", {
 *  members: { photos, videos },
 *  columns: { id: guid("id"), userId: guid("user_id") }
 * });
 *
 * export const userRelations = relations(users, {
 *   feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
 * });
 * ```
 */
export function union<
  TName extends string,
  TMembers extends AnyUnionMembers,
  TColumns extends UnionColumnsConfig<TMembers>,
>(
  name: TName,
  config: UnionConfig<TMembers, TColumns>
): UnionDefinition<TName, TMembers, TColumns> {
  return new UnionDefinition(name, config);
}
