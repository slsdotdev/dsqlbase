import { DefinitionSchema, Executable } from "@dsqlbase/core";
import { BaseClient, withModels } from "./base.js";
import { createTransactionRunner, TxClient } from "./transaction.js";
import { ClientContext } from "../normalizers/context.js";

export class DsqlClient<TDefinition extends DefinitionSchema> extends BaseClient<TDefinition> {
  /**
   * A client carrying `values` for the settings row policies and `$onCreate` read, for the life
   * of one request. Derive it per request, then open transactions on it: a transaction inherits
   * its settings.
   *
   * Called on a client that already carries settings, it merges: `values` are laid over the ones
   * it carries, and `null` unsets one.
   *
   * Declared settings are typed; any other key is accepted too. Nothing is checked: a setting
   * left out renders `NULL`, and the policy that reads it decides — a comparison with `NULL` is
   * never true. The client it is called on stays usable, and a query's SQL is fixed by the client
   * that built it, so concurrent requests never see each other's values.
   */
  public $withClaims(values: Record<string, unknown>): DsqlClient<TDefinition> {
    const ctx = new ClientContext<TDefinition>({
      ...this._ctx,
      pagination: this._ctx.pagination.options,
      settings: Object.freeze({ ...this._ctx.settings, ...values }),
    });
    const client = withModels(new DsqlClient<TDefinition>(ctx));

    return client;
  }

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
