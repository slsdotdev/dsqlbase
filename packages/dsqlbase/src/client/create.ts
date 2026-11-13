import {
  DefinitionSchema,
  ExecutionContext,
  PaginationOptions,
  QueryBuilder,
  SchemaRegistry,
  Session,
} from "@dsqlbase/core";
import { withModels, WithModels } from "./clients/base.js";
import { DsqlClient } from "./clients/dsql.js";

export type ClientOptions<TSchema extends DefinitionSchema> = {
  /**
   * Definition schema for the database, including relations configuration.
   */
  schema: TSchema;

  /**
   * Session object for managing database connections and transactions.
   */
  session: Session;

  /**
   * `bypass: true` skips every row policy on this client and every client derived from it —
   * no predicates on reads, no checks on writes. The `BYPASSRLS` analogue, for a worker or a
   * migration script rather than a request handler. Decided per client, never per call: a
   * per-call escape hatch is a thing to forget.
   */
  policies?: { bypass?: boolean };

  /**
   * Page sizes for `paginate`. `defaultLimit` is used when a call names no `limit` (100 when
   * unset); `maxLimit`, when set, refuses any larger `limit` a call asks for.
   */
  pagination?: PaginationOptions;
};

export type DsqlQueryClient<TSchema extends DefinitionSchema> = WithModels<
  TSchema,
  DsqlClient<TSchema>
>;

/**
 * Creates a new {@link DsqlClient} instance for interacting with the database using the provided schema definition.
 *
 * @example
 * ```ts
 * // schema.ts
 * import { table, text, uuid } from "@dsqlbase/schema";
 *
 * export const users = table("users", {
 *   id: uuid("id").primaryKey().defaultRandom(),
 *   firstName: text("first_name").notNull(),
 *   lastName: text("last_name").notNull(),
 *   emailAddress: text("email_address").notNull().unique(),
 * });
 *
 * export const posts = table("posts", {
 *   id: uuid("id").primaryKey().defaultRandom(),
 *   title: text("title").notNull(),
 *   description: text("description"),
 *   content: text("content").notNull(),
 * });
 *
 * export const userRelations = relations(users, {
 *   posts: hasMany(posts, {
 *     from: [users.columns.id],
 *     to: [posts.columns.userId],
 *   }),
 * });
 *
 * export const postRelations = relations(posts, {
 *   owner: belongsTo(users, {
 *     from: [posts.columns.userId],
 *     to: [users.columns.id],
 *   }),
 * });
 *
 * // client.ts
 * import { createClient } from "dsqlbase";
 * import * as schema from "./schema";
 *
 * export const dsql = createClient({ schema });
 *
 * // Example usage
 * import { dsql } from "./client";
 *
 * const newUser = await dsql.users.create({
 *   data: {
 *     firstName: "John",
 *     lastName: "Doe",
 *     emailAddress: "john.doe@example.com",
 *   },
 * });
 * ```
 * @param options - Configuration options for the client, including the schema definition.
 * @returns A new instance of the DSQL client configured with the provided schema.
 * @throws Will throw an error if the schema definition is invalid or if there are issues initializing the client.
 *
 * @see {@link ClientOptions} for more details on the configuration options.
 */

export function createClient<TSchema extends DefinitionSchema>(
  options: ClientOptions<TSchema>
): DsqlQueryClient<TSchema> {
  const schema = new SchemaRegistry(options.schema);
  const dialect = new QueryBuilder();

  const context = new ExecutionContext({
    schema,
    dialect,
    session: options.session,
    policies: options.policies,
    pagination: options.pagination,
  });

  const client = new DsqlClient(context);

  return withModels(client) as DsqlQueryClient<TSchema>;
}
