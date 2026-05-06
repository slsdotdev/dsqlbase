import { DefinitionSchema } from "@dsqlbase/core";
import { TypedObject } from "@dsqlbase/core/utils";
import {
  AnyTable,
  ExecutableQuery,
  ExecutionContext,
  OperationResult,
  Schema,
} from "@dsqlbase/core/runtime";
import {
  FindOneArgs,
  QueryArgs,
  CreateArgs,
  UpdateArgs,
  DeleteArgs,
  QueryResultOf,
  ReturningResultOf,
} from "./base.js";
import { RequestNormalizer } from "./normalizer.js";

export class ModelClient<
  TTable extends AnyTable,
  TDefinition extends DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
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

  /**
   * Finds multiple records matching the specified criteria.
   *
   * @example
   * ```ts
   * const users = await dsql.users.findMany({
   *   where: { age: { gt: 18 } },
   *   orderBy: [{ age: "desc" }],
   *   limit: 10,
   * });
   * ```
   * @param args The query arguments, including filtering, ordering, pagination, and field selection options.
   * @returns An executable query that can be awaited to retrieve the matching records.
   */

  public findMany<TArgs extends QueryArgs<TTable, this["__type"]>>(
    args: TArgs
  ): ExecutableQuery<OperationResult<"many", QueryResultOf<TTable, this["__type"], TArgs>>> {
    const request = this._normalizer.normalizeSelect(this._table, args, "many");
    const operation = this._ctx.operations.createSelectOperation(this._table, request);

    return new ExecutableQuery(operation, this._ctx.session);
  }

  /**
   * Creates a new record in the database with the specified values.
   *
   * @example
   * ```ts
   * const newUser = await dsql.users.create({
   *   data: {
   *     firstName: "John",
   *     lastName: "Doe",
   *     emailAddress: "john.doe@example.com"
   *   }
   * });
   * ```
   * @param args The arguments for creating a new record, including the data to be inserted.
   * @returns An executable query that can be awaited to retrieve the newly created record.
   */

  public create<TArgs extends CreateArgs<TTable>>(
    args: TArgs
  ): ExecutableQuery<OperationResult<"one", ReturningResultOf<TTable, TArgs>>> {
    const request = this._normalizer.normalizeInsert(this._table, args, "one");
    const operation = this._ctx.operations.createInsertOperation(this._table, request);

    return new ExecutableQuery(operation, this._ctx.session);
  }

  /**
   * Updates records in the database matching the specified criteria with the provided values.
   *
   * @example
   * ```ts
   * const updatedUser = await dsql.users.update({
   *   where: { id: "123" },
   *   set: { emailAddress: "new.email@example.com" }
   * });
   * ```
   * @param args The arguments for updating records, including the criteria for selecting records and the values to be updated.
   * @returns An executable query that can be awaited to retrieve the updated record.
   */

  public update<TArgs extends UpdateArgs<TTable>>(
    args: TArgs
  ): ExecutableQuery<OperationResult<"one", ReturningResultOf<TTable, TArgs>>> {
    const request = this._normalizer.normalizeUpdate(this._table, args, "one");
    const operation = this._ctx.operations.createUpdateOperation(this._table, request);

    return new ExecutableQuery(operation, this._ctx.session);
  }

  /**
   * Deletes records from the database matching the specified criteria.
   *
   * @example
   * ```ts
   * const deletedUser = await dsql.users.delete({
   *   where: { id: "123" }
   *   return: {
   *     id: true,
   *     name: true
   *   }
   * });
   * ```
   * @notes
   * * The `where` clause is required to ensure that the operation is deterministic and does not accidentally delete unintended records.
   *
   * @param args The arguments for deleting records, including the criteria for selecting records to delete.
   * @returns An executable query that can be awaited to retrieve the deleted record.
   */

  public delete<TArgs extends DeleteArgs<TTable>>(
    args: TArgs
  ): ExecutableQuery<OperationResult<"one", ReturningResultOf<TTable, TArgs>>> {
    const request = this._normalizer.normalizeDelete(this._table, args, "one");
    const operation = this._ctx.operations.createDeleteOperation(this._table, request);

    return new ExecutableQuery(operation, this._ctx.session);
  }
}
