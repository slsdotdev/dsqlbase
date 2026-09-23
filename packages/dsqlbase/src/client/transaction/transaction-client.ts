import { DefinitionSchema, ExecutableQuery, ExecutionContext } from "@dsqlbase/core";
import { attachModels, BaseClient } from "../database/base.js";
import { Models, VisibleFor } from "../database/index.js";
import { backoffDelay, isOccError, OCCRetryOptions, sleep } from "./occ-retry.js";

export class TransactionClient<
  TDefinition extends DefinitionSchema,
> extends BaseClient<TDefinition> {}

export type TxClient<
  T extends DefinitionSchema,
  TClaims = never,
  TEnforce extends boolean = true,
> = ([TClaims] extends [never]
  ? TransactionClient<T>
  : Omit<TransactionClient<T>, "$query" | "$execute">) &
  Models<T, VisibleFor<T, TClaims, TEnforce>>;

export async function createTransactionRunner<
  TDefinition extends DefinitionSchema,
  TClaims = never,
  TEnforce extends boolean = true,
>(ctx: ExecutionContext<TDefinition>, options: OCCRetryOptions = {}) {
  if (typeof ctx.session.beginTransaction !== "function") {
    throw new Error("Session does not support transactions");
  }

  const session = await ctx.session.beginTransaction();
  const context = new ExecutionContext<TDefinition>({
    ...ctx,
    session: session,
  });

  const txClient = new TransactionClient<TDefinition>(context);
  attachModels(txClient, context);

  return async <TReturn = unknown>(
    opsOrCallback:
      | ExecutableQuery<TReturn>[]
      | ((client: TxClient<TDefinition, TClaims, TEnforce>) => Promise<TReturn>),
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

      const result = await opsOrCallback(
        txClient as unknown as TxClient<TDefinition, TClaims, TEnforce>
      );
      await session.commit();
      return result;
    } catch (error) {
      await session.rollback();

      if (isOccError(error) && attempt < maxRetries) {
        await sleep(backoffDelay(attempt, delay, maxDelay));
        const runner = await createTransactionRunner<TDefinition, TClaims, TEnforce>(
          ctx,
          options
        );
        return runner(opsOrCallback, attempt + 1);
      }

      throw error;
    }
  };
}
