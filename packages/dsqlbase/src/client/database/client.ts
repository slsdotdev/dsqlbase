import {
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  Schema,
  TenancyError,
} from "@dsqlbase/core";
import { attachModels, BaseClient } from "./base.js";
import { createTransactionRunner, TxClient } from "../transaction/transaction-client.js";
import { ClaimsOf, IdentityClient } from "./index.js";

export class DatabaseClient<
  TDefinition extends DefinitionSchema,
  TClaims = never,
  TEnforce extends boolean = true,
> extends BaseClient<TDefinition> {
  /**
   * A client scoped to `claims`, for the life of one request. Scope first, then open a
   * transaction on the result: a transaction client cannot be scoped, so there is one order.
   *
   * The claims are picked from the argument by name, so `{ ...jwt.claims }` may carry anything
   * else it likes; only what the schema declares is kept. A claim the schema declares but the
   * argument leaves out is allowed — the tables needing it simply are not on the result — but a
   * claim given as `null` or `undefined` throws, because that is a mapping bug rather than a
   * narrower scope. A misspelled claim inside a spread is not caught here, since there is
   * nothing to compare it against, and surfaces at the first tenant table it cannot scope.
   *
   * Derives rather than mutates: the client this was called on stays usable, and a query's SQL
   * is fixed by whichever client built it.
   */
  public $identityClaims<TNewClaims extends Partial<ClaimsOf<Schema<TDefinition>>>>(
    claims: TNewClaims
  ): IdentityClient<TDefinition, TNewClaims> {
    if (this._ctx.identity) {
      throw new TenancyError(
        "This client is already scoped to an identity. Claims are set in exactly one place; " +
          "derive from the base client instead."
      );
    }

    const identity: Record<string, unknown> = {};
    const given = claims as Record<string, unknown>;

    for (const claim of this._ctx.schema.claimKeys.keys()) {
      if (!Object.hasOwn(given, claim)) {
        continue;
      }

      const value = given[claim];

      if (value === undefined || value === null) {
        throw new TenancyError(
          `Claim "${claim}" was given as ${String(value)}. Leave a claim out to narrow what ` +
            `the client can reach; an empty one scopes nothing.`,
          undefined,
          claim
        );
      }

      identity[claim] = value;
    }

    const ctx = new ExecutionContext<TDefinition>({ ...this._ctx, identity });
    const client = new DatabaseClient<TDefinition, TNewClaims, TEnforce>(ctx);

    attachModels(client, ctx);

    return client as unknown as IdentityClient<TDefinition, TNewClaims>;
  }

  public async $transaction<const TQueries extends ExecutableQuery<unknown>[]>(
    queries: TQueries
  ): Promise<{
    -readonly [K in keyof TQueries]: TQueries[K] extends ExecutableQuery<infer TResult>
      ? TResult
      : never;
  }>;
  public async $transaction<TReturn = unknown>(
    callback: (tx: TxClient<TDefinition, TClaims, TEnforce>) => Promise<TReturn>
  ): Promise<TReturn>;
  public async $transaction<TReturn = unknown>(
    arg:
      | ExecutableQuery<TReturn>[]
      | ((client: TxClient<TDefinition, TClaims, TEnforce>) => Promise<TReturn>)
  ): Promise<TReturn> {
    const runner = await createTransactionRunner<TDefinition, TClaims, TEnforce>(this._ctx);
    return runner<TReturn>(arg);
  }
}
