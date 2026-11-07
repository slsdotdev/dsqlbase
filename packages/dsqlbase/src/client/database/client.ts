import { DefinitionSchema, Executable, ExecutionContext } from "@dsqlbase/core";
import { AnySettingsDefinition, NoSettings, SettingValuesOf } from "@dsqlbase/core/definition";
import { attachModels, BaseClient } from "./base.js";
import { createTransactionRunner, TxClient } from "../transaction/transaction-client.js";
import type { QueryClient } from "./index.js";

export class DatabaseClient<
  TDefinition extends DefinitionSchema,
  TSettings extends AnySettingsDefinition = NoSettings,
> extends BaseClient<TDefinition> {
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
  public $settings(
    values: SettingValuesOf<TSettings> & Record<string, unknown>
  ): QueryClient<TDefinition, TSettings> {
    const ctx = new ExecutionContext<TDefinition>({
      ...this._ctx,
      settings: Object.freeze({ ...this._ctx.settings, ...values }),
    });
    const client = new DatabaseClient<TDefinition, TSettings>(ctx);

    attachModels(client, ctx);

    return client as QueryClient<TDefinition, TSettings>;
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
