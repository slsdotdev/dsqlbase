import { DefinitionSchema, Executable } from "@dsqlbase/core";
import { BaseClient, Models, withModels } from "./base.js";
import { backoffDelay, isOccError, OCCRetryOptions, sleep } from "../utils/occ-retry.js";
import { ClientContext } from "../normalizers/context.js";

export class TransactionClient<
  TDefinition extends DefinitionSchema,
> extends BaseClient<TDefinition> {}

export async function createTransactionRunner<TDefinition extends DefinitionSchema>(
  ctx: ClientContext<TDefinition>,
  options: OCCRetryOptions = {}
) {
  if (typeof ctx.session.beginTransaction !== "function") {
    throw new Error("Session does not support transactions");
  }

  const session = await ctx.session.beginTransaction();
  const context = new ClientContext<TDefinition>({
    ...ctx,
    session: session,
    pagination: ctx.pagination.options,
  });

  const txClient = withModels<TDefinition, TransactionClient<TDefinition>>(
    new TransactionClient(context)
  );

  return async <TReturn = unknown>(
    opsOrCallback: Executable<unknown>[] | ((client: TxClient<TDefinition>) => Promise<TReturn>),
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

      const result = await opsOrCallback(txClient);
      await session.commit();
      return result;
    } catch (error) {
      // The error that made it roll back is the one that counts: a rollback that fails too (the
      // connection broke) must not replace it, or a `40001` would no longer be retried.
      await session.rollback().catch(() => undefined);

      if (isOccError(error) && attempt < maxRetries) {
        await sleep(backoffDelay(attempt, delay, maxDelay));
        const runner = await createTransactionRunner<TDefinition>(ctx, options);
        return runner(opsOrCallback, attempt + 1);
      }

      throw error;
    }
  };
}

export type TxClient<T extends DefinitionSchema> = TransactionClient<T> & Models<T>;
