import { DefinitionSchema } from "@dsqlbase/core";
import {
  AnyTable,
  ExecutableQuery,
  ExecutionContext,
  OperationResult,
  Schema,
} from "@dsqlbase/core/runtime";
import { Prettify, TypedObject } from "@dsqlbase/core/utils";
import {
  CreateArgs,
  DeleteArgs,
  FindOneArgs,
  QueryArgs,
  QueryResultOf,
  ReturningResultOf,
  UpdateArgs,
} from "./base.js";
import { RequestNormalizer } from "./normalizer.js";

export class ModelClient<
  TTable extends AnyTable,
  TDefinition extends DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  /** @internal */
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext<TDefinition>;
  private readonly _table: TTable;
  private readonly _normalizer: RequestNormalizer<TDefinition>;

  constructor(ctx: ExecutionContext<TDefinition>, table: TTable) {
    this._ctx = ctx;
    this._table = table;
    this._normalizer = new RequestNormalizer<TDefinition>(ctx);
  }

  /**
   * Finds a single record matching the specified criteria.
   *
   * @example
   * ```ts
   * const user = await dsql.users.findOne({
   *   where: { id: "123" },
   *   select: { id: true, name: true },
   *   join: {
   *     profile: {
   *       select: { bio: true }
   *     }
   *   }
   * });
   * ```
   * @notes
   * * The `where` clause is required to ensure that the operation is deterministic and does not accidentally return an unintended record.
   * * The `select` clause allows you to specify which fields to retrieve, if not provided, all fields will be selected by default.
   *
   * @param args
   * @returns An executable query that can be awaited.
   *
   */

  public findOne<TArgs extends FindOneArgs<TTable, this["__type"]>>(
    args: TArgs
  ): ExecutableQuery<OperationResult<"one", QueryResultOf<TTable, this["__type"], TArgs>>> {
    const request = this._normalizer.normalizeSelect(this._table, args, "one");
    const operation = this._ctx.operations.createSelectOperation(this._table, request);

    return new ExecutableQuery(operation, this._ctx.session);
  }

  public findMany<TArgs extends Prettify<QueryArgs<TTable, this["__type"]>>>(
    args: TArgs
  ): OperationResult<"many", QueryResultOf<TTable, this["__type"], TArgs>> {
    return args as unknown as OperationResult<"many", QueryResultOf<TTable, this["__type"], TArgs>>;
  }

  public create<TArgs extends CreateArgs<TTable>>(
    args: TArgs
  ): OperationResult<"one", ReturningResultOf<TTable, TArgs>> {
    return args as unknown as OperationResult<"one", ReturningResultOf<TTable, TArgs>>;
  }

  public update<TArgs extends UpdateArgs<TTable>>(
    args: TArgs
  ): OperationResult<"one", ReturningResultOf<TTable, TArgs>> {
    return args as unknown as OperationResult<"one", ReturningResultOf<TTable, TArgs>>;
  }

  public delete<TArgs extends DeleteArgs<TTable>>(
    args: TArgs
  ): OperationResult<"one", ReturningResultOf<TTable, TArgs>> {
    return args as unknown as OperationResult<"one", ReturningResultOf<TTable, TArgs>>;
  }

  public upsert() {
    throw new Error("Not implemented");
  }
}
