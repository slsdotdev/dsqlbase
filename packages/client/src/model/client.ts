import { AnyTable, ExecutionContext, OperationResult, Schema } from "@dsqlbase/core/runtime";
import { Prettify, TypedObject } from "@dsqlbase/core/utils";
import {
  CreateArgs,
  DeleteArgs,
  FindManyArgs,
  FindOneArgs,
  QueryResultOf,
  ReturningResultOf,
  UpdateArgs,
} from "./base.js";
import { DefinitionSchema } from "@dsqlbase/core";

export class ModelClient<
  TTable extends AnyTable,
  TDefinition extends DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  /** @internal */
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext<TDefinition>;
  private readonly _table: TTable;

  constructor(ctx: ExecutionContext<TDefinition>, table: TTable) {
    this._ctx = ctx;
    this._table = table;
  }

  public findOne<TArgs extends FindOneArgs<TTable, this["__type"]>>(
    args: TArgs
  ): OperationResult<"one", QueryResultOf<TTable, this["__type"], TArgs>> {
    throw new Error("Not implemented", { cause: args });
  }

  public findMany<TArgs extends Prettify<FindManyArgs<TTable, this["__type"]>>>(
    args: TArgs
  ): OperationResult<"many", QueryResultOf<TTable, this["__type"], TArgs>> {
    throw new Error("Not implemented", { cause: args });
  }

  public create<TArgs extends CreateArgs<TTable>>(
    args: TArgs
  ): OperationResult<"one", ReturningResultOf<TTable, TArgs>> {
    throw new Error("Not implemented", { cause: args });
  }

  public update<TArgs extends UpdateArgs<TTable>>(
    args: TArgs
  ): OperationResult<"one", ReturningResultOf<TTable, TArgs>> {
    throw new Error("Not implemented", { cause: args });
  }

  public upsert() {
    throw new Error("Not implemented");
  }

  public delete<TArgs extends DeleteArgs<TTable>>(
    args: TArgs
  ): OperationResult<"one", ReturningResultOf<TTable, TArgs>> {
    throw new Error("Not implemented", { cause: args });
  }
}
