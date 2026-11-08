import { AnyTable, DefinitionSchema, RuntimeTables, Schema } from "@dsqlbase/core";
import { ModelClient } from "../model/client.js";
import { UnionClient } from "../union/client.js";
import { DatabaseClient } from "./client.js";

/** Every union alias in a schema. */
export type UnionAliases<T extends DefinitionSchema> = keyof Schema<T>["unions"] & string;

/**
 * Every alias in a schema the client addresses a model by: each table, and each union.
 */
export type Aliases<T extends DefinitionSchema> = keyof RuntimeTables<Schema<T>> | UnionAliases<T>;

export type Models<T extends DefinitionSchema, TVisible extends Aliases<T> = Aliases<T>> = {
  readonly [K in TVisible]: K extends keyof RuntimeTables<Schema<T>>
    ? RuntimeTables<Schema<T>>[K] extends infer TTable
      ? TTable extends AnyTable
        ? ModelClient<TTable, T>
        : never
      : never
    : K extends UnionAliases<T>
      ? UnionClient<Schema<T>["unions"][K], T>
      : never;
};

/** A client: the `$`-prefixed methods, and one model per table and union in the schema. */
export type QueryClient<T extends DefinitionSchema> = DatabaseClient<T> & Models<T>;

export { DatabaseClient };
