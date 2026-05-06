import { AnyTable, DefinitionSchema, RuntimeTables, Schema } from "@dsqlbase/core";
import { ModelClient } from "../model/client.js";
import { DatabaseClient } from "./client.js";

export type Models<T extends DefinitionSchema> = {
  readonly [K in keyof RuntimeTables<Schema<T>>]: RuntimeTables<Schema<T>>[K] extends infer TTable
    ? TTable extends AnyTable
      ? ModelClient<TTable, T>
      : never
    : never;
};

export type QueryClient<T extends DefinitionSchema> = DatabaseClient<T> & Models<T>;

export { DatabaseClient };
