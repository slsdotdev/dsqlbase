import { TypedObject } from "../utils/index.js";
import { Relation } from "../definition/index.js";
import { sql, SQLIdentifier, SQLNode, SQLStatement, SQLWrapper } from "../sql/index.js";
import { ExecutionContext } from "./context.js";
import { AnyTable } from "./table.js";
import { AnyColumn } from "./column.js";
import { JoinParams, SelectParams } from "./query.js";
import { AnySchema } from "./base.js";

export type OperationType = "select" | "insert" | "update" | "delete";
export type OperationMode = "one" | "many";

export type OperationResult<TMode extends OperationMode, TResult> = TMode extends "one"
  ? TResult | null
  : TResult[];

export interface Operation<
  TMode extends OperationMode,
  TTable extends AnyTable,
  TArgs extends object,
  TResult = unknown,
> {
  type: OperationType;
  mode: TMode;
  table: TTable;
  name: string;
  args: TArgs;
  query: SQLStatement;
  resolve: (rows: unknown[]) => OperationResult<TMode, TResult>;
}

export type AnyOperation = Operation<OperationMode, AnyTable, object, unknown>;

export interface OperationRequest<
  TArgs extends object,
  TMode extends OperationMode = OperationMode,
> {
  name?: string;
  mode: TMode;
  args: TArgs;
}

export type FieldSelection = [
  fieldName: string,
  column: AnyColumn | SQLIdentifier | FieldSelection[],
];

export type FieldMutation = [column: string | AnyColumn | SQLIdentifier, value: SQLNode];

export type FieldResolver = [fieldName: string, resolver: AnyColumn | FieldResolver[]];

export interface SelectOperationArgs {
  select: FieldSelection[];
  where?: SQLNode | SQLNode[];
  orderBy?: SQLNode[];
  join?: [fieldName: string, args: SelectOperationArgs][];
  distinct?: boolean;
  limit?: number;
  offset?: number;
}

export interface SelectOperation<
  TMode extends OperationMode,
  TTable extends AnyTable,
  TArgs extends SelectOperationArgs,
  TReturn = unknown,
> extends Operation<TMode, TTable, TArgs, TReturn> {
  type: "select";
}

export interface InsertOperationArgs {
  data: FieldMutation[][];
  return?: FieldSelection[];
}

export interface InsertOperation<
  TMode extends OperationMode,
  TTable extends AnyTable,
  TArgs extends InsertOperationArgs,
  TReturn,
> extends Operation<TMode, TTable, TArgs, TReturn> {
  type: "insert";
}

export interface UpdateOperationArgs {
  set: FieldMutation[];
  where?: SQLNode | SQLNode[];
  return?: FieldSelection[];
}

export interface UpdateOperation<
  TMode extends OperationMode,
  TTable extends AnyTable,
  TArgs extends UpdateOperationArgs,
  TReturn = unknown,
> extends Operation<TMode, TTable, TArgs, TReturn> {
  type: "update";
}

export interface DeleteOperationArgs {
  where?: SQLNode | SQLNode[];
  return?: FieldSelection[];
}

export interface DeleteOperation<
  TMode extends OperationMode,
  TTable extends AnyTable,
  TArgs extends DeleteOperationArgs = DeleteOperationArgs,
  TReturn = unknown,
> extends Operation<TMode, TTable, TArgs, TReturn> {
  type: "delete";
}

export class OperationsFactory<
  TSchema extends AnySchema = AnySchema,
> implements TypedObject<TSchema> {
  declare readonly __type: TSchema;

  private readonly _ctx: ExecutionContext;

  constructor(ctx: ExecutionContext) {
    this._ctx = ctx;
  }

  private _validateWhereExpression<T extends AnyTable>(
    table: T,
    where: SQLNode | SQLNode[]
  ): SQLNode {
    if (Array.isArray(where)) {
      return where[0];
    }

    return where;
  }

  private _validateOrderExpression<T extends AnyTable>(table: T, order: SQLNode[]): SQLNode[] {
    return order;
  }

  private _resolveFields<T extends AnyTable>(table: T, selection?: FieldSelection[]) {
    const columns: AnyColumn[] = [];
    const resolvers: FieldResolver[] = [];

    if (!selection || selection.length === 0) {
      for (const [key, column] of Object.entries<AnyColumn>(table.columns)) {
        columns.push(column);
        resolvers.push([key, column]);
      }

      return { columns, resolvers };
    }

    for (const [key, selected] of selection) {
      if (selected) {
        const column = table.columns[key as keyof typeof table.columns];

        if (!column) {
          throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
        }

        columns.push(column);
        resolvers.push([key, column]);
      }
    }

    return { columns, resolvers };
  }

  private _resolveInsertEntries<T extends AnyTable>(
    table: T,
    data: FieldMutation[][]
  ): [SQLNode[], SQLNode[][]] {
    const columns: SQLNode[] = [];
    const rows: SQLNode[][] = [];

    for (const record of data) {
      const row: SQLNode[] = [];

      for (const [key, value] of record) {
        const column = table.getColumn(typeof key === "string" ? key : key.name);

        if (!column) {
          throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
        }

        columns.push(new SQLIdentifier(column.name));
        row.push(value);
      }

      rows.push(row);
    }

    return [columns, rows];
  }

  private _resolveUpdateEntries<T extends AnyTable>(
    table: T,
    data: FieldMutation[]
  ): [SQLNode, SQLNode][] {
    const entries: [SQLNode, SQLNode][] = [];

    for (const [key, value] of data) {
      const column = table.getColumn(typeof key === "string" ? key : key.name);

      if (!column) {
        throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
      }

      if (column.primaryKey) {
        throw new Error(`Cannot update primary key column "${key}"`);
      }

      entries.push([new SQLIdentifier(column.name), value]);
    }

    return entries;
  }

  private _resolveSelectParams<T extends AnyTable>(
    table: T,
    args: SelectOperationArgs,
    mode: OperationMode,
    resolvers: FieldResolver[] = []
  ) {
    const fields = this._resolveFields(table, args.select);
    resolvers.push(...fields.resolvers);

    const where = args.where ? this._validateWhereExpression(table, args.where) : undefined;
    const order = args.orderBy ? this._validateOrderExpression(table, args.orderBy) : undefined;
    const join = args.join ? this._resolveJoinEntries(table, args.join, resolvers) : undefined;
    const limit = mode === "one" ? 1 : args.limit;

    return {
      table,
      select: fields.columns,
      distinct: args.distinct,
      where,
      order,
      limit: limit,
      offset: args.offset,
      join,
      resolvers,
    };
  }

  private _resolveJoinEntries<T extends AnyTable>(
    table: T,
    join: [SQLIdentifier | string, SelectOperationArgs][],
    resolvers: FieldResolver[]
  ): JoinParams[] {
    const joins: JoinParams[] = [];

    if (!join || Object.keys(join).length === 0) {
      return joins;
    }

    for (const [key, value] of join) {
      const fieldName = typeof key === "string" ? key : key.name;

      const relation = table.getRelation(fieldName);

      if (!relation) {
        throw new Error(`Relation "${fieldName}" does not exist on table "${table.name}"`);
      }

      const targetTable = this._ctx.schema.getRelationTarget(table.name, fieldName);

      if (!targetTable) {
        throw new Error(
          `Target table for relation "${key}" on table "${table.name}" not found in schema`
        );
      }

      const fromColumn = table.getColumn(relation.from[0].name);
      const toColumn = targetTable.getColumn(relation.to[0].name);

      if (!fromColumn || !toColumn) {
        throw new Error(
          `Invalid relation "${key}" on table "${table.name}": missing columns "${relation.from[0].name}" or "${relation.to[0].name}"`
        );
      }

      const joinResolvers: FieldResolver[] = [];
      const params: SelectParams = this._resolveSelectParams(
        targetTable,
        value,
        relation.type === Relation.HAS_MANY ? "many" : "one",
        joinResolvers
      );

      const connection =
        relation.type === Relation.BELONGS_TO
          ? sql.eq(fromColumn, toColumn)
          : sql.eq(toColumn, fromColumn);

      joins.push({
        alias: fieldName,
        type: relation.type === "has_many" ? "many" : "one",
        from: fromColumn,
        to: toColumn,
        params: {
          ...params,
          where: params.where
            ? sql.and([
                connection,
                params.where instanceof SQLWrapper ? params.where : new SQLWrapper(params.where),
              ])
            : connection,
        },
      });

      resolvers.push([fieldName, joinResolvers]);
    }

    return joins;
  }

  public _createResultResolver<TMode extends OperationMode, TResult extends object>(
    resolvers: FieldResolver[],
    mode: TMode
  ): (rows: unknown[]) => OperationResult<TMode, TResult> {
    return (rows: unknown[]): OperationResult<TMode, TResult> => {
      const results: TResult[] = [];

      for (const row of rows as Record<string, unknown>[]) {
        const result: Record<string, unknown> = {};

        for (const [key, resolver] of resolvers) {
          if (Array.isArray(resolver)) {
            const nestedRows = row[key];

            if (typeof nestedRows === "undefined" || nestedRows === null) {
              result[key] = null;
              continue;
            }

            const nestedResolver = this._createResultResolver(
              resolver,
              Array.isArray(nestedRows) ? "many" : "one"
            );

            result[key] = nestedResolver(Array.isArray(nestedRows) ? nestedRows : [nestedRows]);

            continue;
          }

          result[key] = resolver.resolve(row[resolver.name]);
        }

        results.push(result as TResult);
      }

      if (mode === "one") {
        return (results[0] ?? null) as OperationResult<TMode, TResult>;
      }

      return results as OperationResult<TMode, TResult>;
    };
  }

  public createSelectOperation<
    TResult extends object,
    TTable extends AnyTable,
    TMode extends OperationMode = OperationMode,
    TArgs extends SelectOperationArgs = SelectOperationArgs,
  >(
    table: TTable,
    config: OperationRequest<TArgs, TMode>
  ): SelectOperation<TMode, TTable, TArgs, TResult> {
    const { name, args, mode } = config;

    const { resolvers: fieldResolvers, ...params } = this._resolveSelectParams(table, args, mode);
    const query = this._ctx.dialect.buildSelectQuery(params);

    return {
      type: "select",
      table: table,
      mode: mode,
      name: name ?? `select_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver<TMode, TResult>(fieldResolvers, mode),
    };
  }

  public createInsertOperation<
    TResult extends object,
    TTable extends AnyTable,
    TMode extends OperationMode,
    TArgs extends InsertOperationArgs,
  >(
    table: TTable,
    config: OperationRequest<TArgs, TMode>
  ): InsertOperation<TMode, TTable, TArgs, TResult> {
    const { name, args, mode } = config;

    const [columns, values] = this._resolveInsertEntries(table, args.data);
    const selection = this._resolveFields(table, args.return);

    const query = this._ctx.dialect.buildInsertQuery({
      table,
      columns,
      values,
      return: selection.columns,
    });

    return {
      type: "insert",
      mode: config.mode,
      table: table,
      name: name ?? `insert_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver<TMode, TResult>(selection.resolvers, mode),
    };
  }

  public createUpdateOperation<
    TResult extends object,
    TMode extends OperationMode = OperationMode,
    TTable extends AnyTable = AnyTable,
    TArgs extends UpdateOperationArgs = UpdateOperationArgs,
  >(
    table: TTable,
    config: OperationRequest<TArgs, TMode>
  ): UpdateOperation<TMode, TTable, TArgs, TResult> {
    const { name, args, mode } = config;

    const entries = this._resolveUpdateEntries(table, args.set);
    const where = args.where ? this._validateWhereExpression(table, args.where) : undefined;
    const selection = this._resolveFields(table, args.return);

    const query = this._ctx.dialect.buildUpdateQuery({
      table,
      set: entries,
      where,
      return: selection.columns,
    });

    return {
      type: "update",
      table: table,
      mode,
      name: name ?? `update_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver<TMode, TResult>(selection.resolvers, mode),
    };
  }

  public createDeleteOperation<
    TResult extends object,
    TMode extends OperationMode = OperationMode,
    TTable extends AnyTable = AnyTable,
    TArgs extends DeleteOperationArgs = DeleteOperationArgs,
  >(
    table: TTable,
    config: OperationRequest<TArgs, TMode>
  ): DeleteOperation<TMode, TTable, TArgs, TResult> {
    const { name, args, mode } = config;

    const where = args.where ? this._validateWhereExpression(table, args.where) : undefined;
    const selection = this._resolveFields(table, args.return);

    const query = this._ctx.dialect.buildDeleteQuery({
      table,
      where,
      return: selection.columns,
    });

    return {
      type: "delete",
      table: table,
      mode: config.mode,
      name: name ?? `delete_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver<TMode, TResult>(selection.resolvers, mode),
    };
  }
}
