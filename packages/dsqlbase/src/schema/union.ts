import { AnyUnionMembers, UnionDefinition } from "@dsqlbase/core/definition";

/**
 * Defines a set of tables that can stand in for one another — a GraphQL union or interface.
 *
 * Key every member by the alias it is exported under in the schema; the client refuses any
 * other key when it is built. `union.columns` holds the fields every member shares with the
 * same type, which is what a relation's `to` and cross-member filters and ordering can use.
 * A union produces no DDL.
 *
 * @param members The member tables, keyed by schema alias.
 *
 * @example
 * ```ts
 * export const photos = table("photos", { id: guid("id").primaryKey(), userId: uuid("user_id") });
 * export const videos = table("videos", { id: guid("id").primaryKey(), userId: uuid("user_id") });
 *
 * export const posts = union({ photos, videos });   // posts.columns: { id, userId }
 *
 * export const userRelations = relations(users, {
 *   feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
 * });
 * ```
 */
export function union<TMembers extends AnyUnionMembers>(
  members: TMembers
): UnionDefinition<TMembers> {
  return new UnionDefinition(members);
}
