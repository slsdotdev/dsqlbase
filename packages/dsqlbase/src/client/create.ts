import { AnySettingsDefinition, NoSettings } from "@dsqlbase/core/definition";
import {
  DefinitionSchema,
  ExecutionContext,
  PaginationOptions,
  QueryBuilder,
  SchemaRegistry,
  Session,
} from "@dsqlbase/core";
import { attachModels } from "./database/base.js";
import { registerNodes } from "./nodes.js";
import { DatabaseClient, QueryClient } from "./database/index.js";

export type ClientOptions<
  TSchema extends DefinitionSchema,
  TSettings extends AnySettingsDefinition = NoSettings,
> = {
  /**
   * Definition schema for the database, including relations configuration.
   */
  schema: TSchema;

  /**
   * Session object for managing database connections and transactions.
   */
  session: Session;

  /**
   * The settings row policies and `$onCreate` read — a `settings({ ... })` declaration. It types
   * `$settings()`; values are given per request through it. Not a schema object: it describes
   * the request, not the data, so the registry and migrations never see it.
   */
  settings?: TSettings;

  /**
   * Page sizes for `paginate`. `defaultLimit` is used when a call names no `limit` (100 when
   * unset); `maxLimit`, when set, refuses any larger `limit` a call asks for.
   */
  pagination?: PaginationOptions;
};

function assertPagination(options: PaginationOptions | undefined) {
  for (const [name, value] of Object.entries(options ?? {})) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`pagination.${name} must be a positive integer (got ${String(value)}).`);
    }
  }

  const { defaultLimit, maxLimit } = options ?? {};

  if (defaultLimit !== undefined && maxLimit !== undefined && defaultLimit > maxLimit) {
    throw new Error(
      `pagination.defaultLimit (${defaultLimit}) exceeds pagination.maxLimit (${maxLimit}).`
    );
  }
}

/**
 * Creates a new client instance for interacting with the database using the provided schema definition.
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
 * @see {@link ClientOptions} for more details on the configuration options.
 * @see {@link ModelClient} for information on the methods available for interacting with the database tables.
 */

export function createClient<
  TSchema extends DefinitionSchema,
  TSettings extends AnySettingsDefinition = NoSettings,
>(options: ClientOptions<TSchema, TSettings>): QueryClient<TSchema, TSettings> {
  assertPagination(options.pagination);

  const schema = new SchemaRegistry(options.schema);
  const dialect = new QueryBuilder();

  // Finds the tables a global id can address. Here rather than inside `SchemaRegistry`, because
  // the shape of an id is a client concern; what each guid() column's ids name is read by its
  // hooks, from the references core sets.
  registerNodes(schema, options.schema);

  const context = new ExecutionContext({
    schema,
    dialect,
    session: options.session,
    pagination: options.pagination,
  });

  const dbClient = new DatabaseClient(context);
  attachModels(dbClient, context);

  return dbClient as unknown as QueryClient<TSchema, TSettings>;
}
