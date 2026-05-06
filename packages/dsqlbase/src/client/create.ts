import {
  AnyTable,
  DefinitionSchema,
  ExecutionContext,
  QueryBuilder,
  SchemaRegistry,
  Session,
} from "@dsqlbase/core";
import { ModelClient } from "./model/client.js";
import { DatabaseClient, QueryClient } from "./database/index.js";

export interface ClientOptions<TSchema extends DefinitionSchema> {
  /**
   * Definition schema for the database, including relations configuration.
   */
  schema: TSchema;

  /**
   * Session object for managing database connections and transactions.
   */
  session: Session;
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
 * import { createClient } from "@dsqlbase/client";
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

export function createClient<TSchema extends DefinitionSchema>(
  options: ClientOptions<TSchema>
): QueryClient<TSchema> {
  const schema = new SchemaRegistry(options.schema);
  const dialect = new QueryBuilder();

  const context = new ExecutionContext({
    schema,
    dialect,
    session: options.session,
  });

  const dbClient = new DatabaseClient(context);

  for (const [tableName, table] of Object.entries<AnyTable>(schema.getTables())) {
    const modelClient = new ModelClient(context, table);

    Object.defineProperty(dbClient, tableName, {
      value: modelClient,
      writable: false,
      enumerable: true,
    });
  }

  return dbClient as QueryClient<TSchema>;
}
