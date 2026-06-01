import {
  AnyTable,
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  TransactionSession,
} from "@dsqlbase/core";
import { BaseClient } from "../database/base.js";
import { ModelClient } from "../model/client.js";
import { Models } from "../database/index.js";
import { backoffDelay, isOccError, OCCRetryOptions, sleep } from "./occ-retry.js";

export class TransactionClient<
  TDefinition extends DefinitionSchema,
> extends BaseClient<TDefinition> {
  private readonly _session: TransactionSession;

  constructor(ctx: ExecutionContext<TDefinition>, session: TransactionSession) {
    super(ctx);
    this._session = session;
  }
}

export type TxClient<T extends DefinitionSchema> = TransactionClient<T> & Models<T>;

export async function createTransactionRunner<TDefinition extends DefinitionSchema>(
  ctx: ExecutionContext<TDefinition>,
  options: OCCRetryOptions = {}
) {
  if (typeof ctx.session.beginTransaction !== "function") {
    throw new Error("Session does not support transactions");
  }

  const session = await ctx.session.beginTransaction();
  const context = new ExecutionContext<TDefinition>({
    ...ctx,
    session: session,
  });

  const txClient = new TransactionClient<TDefinition>(context, session);

  for (const [tableName, table] of Object.entries<AnyTable>(ctx.schema.getTables())) {
    const modelClient = new ModelClient(context, table);

    Object.defineProperty(txClient, tableName, {
      value: modelClient,
      writable: false,
      enumerable: true,
    });
  }

  return async <TReturn = unknown>(
    opsOrCallback:
      | ExecutableQuery<TReturn>[]
      | ((client: TxClient<TDefinition>) => Promise<TReturn>),
    attempt = 1
  ): Promise<TReturn> => {
    const { maxRetries = 3, delay = 50, maxDelay = 1000 } = options;

    try {
      if (Array.isArray(opsOrCallback)) {
        const results: unknown[] = [];

        for (const op of opsOrCallback) {
          const result = await op.clone(session).execute();
          results.push(result);
        }

        await session.commit();
        return results as TReturn;
      }

      const result = await opsOrCallback(txClient as TxClient<TDefinition>);
      await session.commit();
      return result;
    } catch (error) {
      await session.rollback();

      if (isOccError(error) && attempt < maxRetries) {
        await sleep(backoffDelay(attempt, delay, maxDelay));
        const runner = await createTransactionRunner(ctx, options);
        return runner(opsOrCallback, attempt + 1);
      }

      throw error;
    }
  };
}
