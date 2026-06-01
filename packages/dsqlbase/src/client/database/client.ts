import { DefinitionSchema, ExecutableQuery } from "@dsqlbase/core";
import { BaseClient } from "./base.js";
import { createTransactionRunner, TxClient } from "../transaction/transaction-client.js";

export class DatabaseClient<TDefinition extends DefinitionSchema> extends BaseClient<TDefinition> {
  public async $transaction<const TQueries extends ExecutableQuery<unknown>[]>(
    queries: TQueries
  ): Promise<{
    -readonly [K in keyof TQueries]: TQueries[K] extends ExecutableQuery<infer TResult>
      ? TResult
      : never;
  }>;
  public async $transaction<TReturn = unknown>(
    callback: (tx: TxClient<TDefinition>) => Promise<TReturn>
  ): Promise<TReturn>;
  public async $transaction<TReturn = unknown>(
    arg: ExecutableQuery<TReturn>[] | ((client: TxClient<TDefinition>) => Promise<TReturn>)
  ): Promise<TReturn> {
    const runner = await createTransactionRunner(this._ctx);
    return runner<TReturn>(arg);
  }
}
