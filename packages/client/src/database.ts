import { DefinitionSchema } from "@dsqlbase/core";
import { QueryClient } from "./base.js";

export class DatabaseClient<TDefinition extends DefinitionSchema> extends QueryClient<TDefinition> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $transaction<T>(fn: (tx: QueryClient<TDefinition>) => Promise<T>): Promise<T> {
    throw new Error("Method not implemented.");
  }
}
