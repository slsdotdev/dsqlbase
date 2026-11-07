import { DefinitionSchema, Executable } from "@dsqlbase/core";
import { BaseClient } from "./base.js";
import { createTransactionRunner, TxClient } from "../transaction/transaction-client.js";

export class DatabaseClient<TDefinition extends DefinitionSchema> extends BaseClient<TDefinition> {
  public async $transaction<const TQueries extends Executable<unknown>[]>(
    queries: TQueries
  ): Promise<{
    -readonly [K in keyof TQueries]: TQueries[K] extends Executable<infer TResult>
      ? TResult
      : never;
  }>;
  public async $transaction<TReturn = unknown>(
    callback: (tx: TxClient<TDefinition>) => Promise<TReturn>
  ): Promise<TReturn>;
  public async $transaction<TReturn = unknown>(
    arg: Executable<unknown>[] | ((client: TxClient<TDefinition>) => Promise<TReturn>)
  ): Promise<TReturn> {
    const runner = await createTransactionRunner<TDefinition>(this._ctx);
    return runner<TReturn>(arg);
  }
}
