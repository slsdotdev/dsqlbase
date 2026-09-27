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
> extends UUIDColumnDefinition<TName, TConfig> {
  /**
   * The node key this column's values name, when the declaration overrode it.
   *
   * `undefined` means "the table this column is declared on", resolved to that table's schema
   * alias when the client is built — a column cannot know its own alias, since the alias is
   * the key it is exported under.
   */
  protected _guidKey: string | undefined;

  constructor(name: TName, config: Partial<TConfig> = {}, key?: string) {
    super(name, config);

    this._guidKey = key;
  }
}

/**
 * Defines a `uuid` column whose values are global ids — opaque strings naming both the row and
 * the table it belongs to, rather than a bare uuid that could have come from anywhere.
 *
 * A table is a **node** when its primary key is exactly one `guid()` column. Its node key is
 * the table's schema alias, so `dsql.members` produces ids keyed `members` even though the
 * table is `team_members`.
 *
 * @param name The database column name.
 * @param key The node this column *points at*, for a column that is not its own table's key.
 *   A relation key column takes the alias of the table it references, so
 *   `article.authorId === article.author.id` holds without the application unwrapping either.
 *   Omit it on a primary key, and on a self reference.
 *
 * @example
 * ```ts
 * export const authors = table("authors", {
 *   id: guid("id").primaryKey().defaultRandom(),          // node key: "authors"
 * });
 *
 * export const articles = table("articles", {
 *   id: guid("id").primaryKey().defaultRandom(),          // node key: "articles"
 *   authorId: guid("author_id", "authors").notNull(),     // points at the authors node
 *   parentId: guid("parent_id"),                          // self reference: "articles"
 * });
 * ```
 *
 * Migration-neutral: a `guid()` column serializes exactly as `uuid()`, so adopting it on an
 * existing column produces no DDL.
 */
export function guid<const TName extends string>(name: TName, key?: string) {
  return new GuidColumnDefinition<TName, ColumnConfig<string, string>>(
    name,
    {
      dataType: "uuid",
      codec: { encode: (value) => value, decode: (value) => value },
    },
    key
  ) as Guid<GuidColumnDefinition<TName, ColumnConfig<string, string>>>;
}
