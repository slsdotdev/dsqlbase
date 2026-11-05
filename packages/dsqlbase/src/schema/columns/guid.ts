import { ColumnConfig } from "@dsqlbase/core";
import { TypedObject } from "@dsqlbase/core/utils";
import { UUIDColumnDefinition } from "./uuid.js";

/**
 * Marks a column definition as carrying global ids.
 *
 * Follows the `NotNull` / `ReadOnly` shape: a refinement written into `__type`, so it survives
 * `.primaryKey()`, `.notNull()` and `.defaultRandom()`, which all return `this` re-typed.
 */
export type Guid<T extends TypedObject> = T & { __type: { guid: true } };

export class GuidColumnDefinition<
  TName extends string,
  TConfig extends ColumnConfig,
> extends UUIDColumnDefinition<TName, TConfig> {}

/**
 * Defines a `uuid` column whose values are global ids — opaque strings naming both the row and
 * the table it belongs to, rather than a bare uuid that could have come from anywhere.
 *
 * A guid primary key makes a table's rows emit their own ids. They are keyed by the table's
 * schema alias, so `dsql.members` produces ids keyed `members` even though the table is
 * `team_members`. An id resolves by any of the table's unique keys, not only this one.
 *
 * What a column's ids name is resolved when the client is built, from the relations:
 *
 * - a relation key column — the `from` of a `belongsTo`, the `to` of a `hasMany` / `hasOne` —
 *   names the column it is paired with, so `article.authorId === article.author.id` holds
 *   without the application unwrapping either;
 * - the `from` of a `belongsTo` a union names whichever member its discriminator says;
 * - any other column names its own table and field: a primary key is the table's node id, and an
 *   unrelated `photos.ownerId` reads as `["photos", { ownerId }]`.
 *
 * @param name The database column name.
 *
 * @example
 * ```ts
 * export const authors = table("authors", {
 *   id: guid("id").primaryKey().defaultRandom(),   // node key: "authors"
 * });
 *
 * export const articles = table("articles", {
 *   id: guid("id").primaryKey().defaultRandom(),   // node key: "articles"
 *   authorId: guid("author_id").notNull(),         // an authors id, through the relation below
 * });
 *
 * export const articleRelations = relations(articles, {
 *   author: belongsTo(authors, { from: [articles.columns.authorId], to: [authors.columns.id] }),
 * });
 * ```
 *
 * Migration-neutral: a `guid()` column serializes exactly as `uuid()`, so adopting it on an
 * existing column produces no DDL.
 */
export function guid<const TName extends string>(name: TName) {
  return new GuidColumnDefinition<TName, ColumnConfig<string, string, "uuid">>(name, {
    dataType: "uuid",
    runtimeType: "uuid",
    codec: { encode: (value) => value, decode: (value) => value },
  }) as Guid<GuidColumnDefinition<TName, ColumnConfig<string, string, "uuid">>>;
}
