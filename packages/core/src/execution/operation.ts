import { AnyColumnDefinition } from "../definition/column.js";
import { AnyTableRelations, Relation } from "../definition/relations.js";
import { AnyTableDefinition, TableDefinition } from "../definition/table.js";
import {
  and,
  between,
  equals,
  greaterThan,
  greaterThanOrEquals,
  inList,
  isNull,
  lessThan,
  lessThanOrEquals,
  like,
  not,
  notEquals,
  notLike,
  or,
} from "../sql/expressions.js";
import { SQLNode, SQLStatement } from "../sql/nodes.js";
import { sql } from "../sql/tag.js";
import { TypedObject } from "../types/object.js";
import { Prettify } from "../types/prettify.js";
import { AnyColumn } from "./column.js";
import { ExecutionContext } from "./context.js";
import { JoinParams, SelectParams } from "./dialect.js";
import { AnyTable, Table } from "./table.js";
import { AnySchema, SchemaRelationsOf } from "./types.js";

export type OrderDirection = "asc" | "desc";

export type FieldResolver = [string, AnyColumn | FieldResolver[]];

export interface FieldSelection {
  columns: AnyColumn[];
  resolvers: FieldResolver[];
}

export interface FilterCondition<Value = unknown> {
  eq?: Value;
  ne?: Value;
  gt?: Value;
  gte?: Value;
  lt?: Value;
  lte?: Value;
  in?: Value[];
  notIn?: Value[];
  between?: [Value, Value];
  like?: string;
  notLike?: string;
  iLike?: string;
  notILike?: string;
  isNull?: boolean;
  isNotNull?: boolean;
}

export type WhereExpressionOf<T extends AnyTable> =
  | {
      [K in keyof T["__type"]["columns"]]?: T["__type"]["columns"][K] extends AnyColumnDefinition
        ? FilterCondition
        : never;
    }
  | { and?: WhereExpressionOf<T>[] }
  | { or?: WhereExpressionOf<T>[] }
  | { not?: WhereExpressionOf<T> };

export type ColumnSelectionOf<T extends AnyTable> = {
  [K in keyof T["__type"]["columns"]]?: T["__type"]["columns"][K] extends AnyColumnDefinition
    ? boolean
    : never;
};

export type OrderByExpressionOf<T extends AnyTable> = {
  [K in keyof T["__type"]["columns"]]?: T["__type"]["columns"][K] extends AnyColumnDefinition
    ? OrderDirection
    : never;
};

export type InsertRecordOf<TTable extends AnyTable> = Prettify<{
  [K in keyof TTable["columns"]]: TTable["columns"][K] extends AnyColumn
    ? string | null | undefined
    : never;
}>;

export type UpdateRecordOf<TTable extends AnyTable> = Prettify<{
  [K in keyof TTable["columns"]]?: TTable["columns"][K] extends AnyColumn
    ? TTable["columns"][K]["primaryKey"] extends true
      ? never
      : string | null | undefined
    : never;
}>;

export type JoinExpressionOf<
  T extends AnyTable,
  S extends AnySchema,
> = T["__type"]["relations"] extends AnyTableRelations
  ? {
      [K in keyof T["__type"]["relations"]]?: T["__type"]["relations"][K] extends Relation<
        AnyTableDefinition,
        TableDefinition<infer TargetName, infer TargetConfig>
      >
        ? SelectArgs<Table<TargetName, TargetConfig, SchemaRelationsOf<S, TargetName>>, S> | boolean
        : never;
    }
  : never;

export interface SelectArgs<T extends AnyTable, TSchema extends AnySchema = AnySchema> {
  select: ColumnSelectionOf<T>;
  where?: WhereExpressionOf<T>;
  orderBy?: OrderByExpressionOf<T>;
  join?: JoinExpressionOf<T, TSchema>;
  distinct?: boolean;
  limit?: number;
  offset?: number;
}

export type ColumnValueOf<T extends AnyColumnDefinition> = T["__type"]["notNull"] extends true
  ? T["__type"]["valueType"]
  : T["__type"]["valueType"] | null;

export type RecordOf<T extends AnyTable> = {
  [K in keyof T["__type"]["columns"]]: ColumnValueOf<T["__type"]["columns"][K]>;
};

export type SelectionOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends SelectArgs<TTable, TSchema>,
> = keyof TArgs["select"] extends never
  ? RecordOf<TTable>
  : {
      [K in keyof TArgs["select"]]: TArgs["select"][K] extends true
        ? K extends keyof TTable["__type"]["columns"]
          ? TTable["__type"]["columns"][K] extends AnyColumnDefinition
            ? ColumnValueOf<TTable["__type"]["columns"][K]>
            : never
          : never
        : never;
    };

export type RelationTargetTable<TShema extends AnySchema, TRelation extends string> =
  TShema["relations"] extends Record<TRelation, infer R>
    ? R extends AnyTableRelations
      ? R
      : never
    : never;

export type SelectResult<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends SelectArgs<TTable, TSchema>,
> = Prettify<
  SelectionOf<TTable, TSchema, TArgs> & {
    [K in keyof TArgs["join"]]: TArgs["join"][K] extends JoinExpressionOf<TTable, TSchema>[K]
      ? K extends keyof TTable["__type"]["relations"]
        ? TTable["__type"]["relations"][K]["target"] extends TableDefinition<
            infer TargetName,
            infer TargetConfig
          >
          ? TArgs["join"][K] extends boolean
            ? OperationResult<
                TTable["__type"]["relations"][K]["type"] extends "has_many" ? "many" : "one",
                SelectResult<
                  Table<TargetName, TargetConfig, SchemaRelationsOf<TSchema, TargetName>>,
                  TSchema,
                  { select: object }
                >
              >
            : TArgs["join"][K] extends SelectArgs<
                  Table<TargetName, TargetConfig, SchemaRelationsOf<TSchema, TargetName>>,
                  TSchema
                >
              ? OperationResult<
                  TTable["__type"]["relations"][K]["type"] extends "has_many" ? "many" : "one",
                  SelectResult<
                    Table<TargetName, TargetConfig, SchemaRelationsOf<TSchema, TargetName>>,
                    TSchema,
                    TArgs["join"][K]
                  >
                >
              : never
          : never
        : never
      : never;
  }
>;

export interface InsertArgs<T extends AnyTable = AnyTable> {
  data: InsertRecordOf<T> | InsertRecordOf<T>[];
  return?: ColumnSelectionOf<T>;
}

export interface UpdateArgs<T extends AnyTable = AnyTable> {
  set: UpdateRecordOf<T>;
  where: WhereExpressionOf<T>;
  return?: ColumnSelectionOf<T>;
}

export interface DeleteArgs<T extends AnyTable = AnyTable> {
  where: WhereExpressionOf<T>;
  return?: ColumnSelectionOf<T>;
}

export type OperationType = "select" | "insert" | "update" | "delete";
export type OperationMode = "one" | "many";

export interface Operation<TTable extends AnyTable, TArgs extends object, TReturn = unknown> {
  type: OperationType;
  table: TTable;
  name: string;
  mode: OperationMode;
  args: TArgs;
  query: SQLStatement;
  resolve: (rows: unknown[]) => TReturn;
}

interface OperationOptions<TArgs extends object, TMode extends OperationMode = OperationMode> {
  name?: string;
  mode: TMode;
  args: TArgs;
}

export type OperationResult<TMode extends OperationMode, TReturn> = TMode extends "one"
  ? TReturn | null
  : TReturn[];

export interface SelectOperation<
  TTable extends AnyTable,
  TArgs extends SelectArgs<TTable> = SelectArgs<TTable>,
  TReturn = unknown,
> extends Operation<TTable, TArgs, TReturn> {
  type: "select";
}

export interface InsertOperation<
  TTable extends AnyTable,
  TArgs extends InsertArgs = InsertArgs,
  TReturn = unknown,
> extends Operation<TTable, TArgs, TReturn> {
  type: "insert";
}

export interface UpdateOperation<
  TTable extends AnyTable,
  TArgs extends UpdateArgs = UpdateArgs,
  TReturn = unknown,
> extends Operation<TTable, TArgs, TReturn> {
  type: "update";
}

export interface DeleteOperation<
  TTable extends AnyTable,
  TArgs extends DeleteArgs = DeleteArgs,
  TReturn = unknown,
> extends Operation<TTable, TArgs, TReturn> {
  type: "delete";
}

export class OperationFactory<
  TSchema extends AnySchema = AnySchema,
> implements TypedObject<TSchema> {
  declare readonly __type: TSchema;

  private readonly _ctx: ExecutionContext;

  constructor(ctx: ExecutionContext) {
    this._ctx = ctx;
  }

  private _resolveFields(
    table: AnyTable,
    selection?: Partial<Record<string, boolean>>
  ): FieldSelection {
    const columns: AnyColumn[] = [];
    const resolvers: FieldResolver[] = [];

    if (!selection || Object.keys(selection).length === 0) {
      for (const [key, column] of Object.entries(table.columns)) {
        columns.push(column);
        resolvers.push([key, column]);
      }

      return { columns, resolvers };
    }

    for (const [key, selected] of Object.entries(selection)) {
      if (selected) {
        const column = table.columns[key];

        if (!column) {
          throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
        }

        columns.push(column);
        resolvers.push([key, column]);
      }
    }

    return { columns, resolvers };
  }

  private _resolveWhereExpression<T extends AnyTable>(
    table: T,
    expression: WhereExpressionOf<T>,
    wrap = false
  ): SQLNode {
    const conditions: SQLNode[] = [];

    if ("and" in expression && Array.isArray(expression["and"])) {
      const nodes = expression.and.map((expr) => this._resolveWhereExpression(table, expr, true));
      conditions.push(...nodes);
    }

    if ("or" in expression && Array.isArray(expression["or"])) {
      const nodes = expression.or.map((expr) => this._resolveWhereExpression(table, expr, true));
      conditions.push(or([...nodes]));
    }

    if ("not" in expression && expression.not) {
      const node = this._resolveWhereExpression(
        table,
        expression.not as WhereExpressionOf<T>,
        true
      );
      conditions.push(not(node));
    }

    for (const [key, condition] of Object.entries(expression)) {
      if (["and", "or", "not"].includes(key)) {
        continue;
      }

      const column = table.getColumn(key);

      if (!column) {
        continue;
      }

      if (condition.eq !== undefined) {
        conditions.push(equals(column, condition.eq));
      }

      if (condition.ne !== undefined) {
        conditions.push(notEquals(column, condition.ne));
      }

      if (condition.gt !== undefined) {
        conditions.push(greaterThan(column, condition.gt));
      }

      if (condition.gte !== undefined) {
        conditions.push(greaterThanOrEquals(column, condition.gte));
      }

      if (condition.lt !== undefined) {
        conditions.push(lessThan(column, condition.lt));
      }

      if (condition.lte !== undefined) {
        conditions.push(lessThanOrEquals(column, condition.lte));
      }

      if (condition.in !== undefined) {
        conditions.push(inList(column, condition.in));
      }

      if (condition.notIn !== undefined) {
        conditions.push(not(inList(column, condition.notIn)));
      }

      if (condition.between !== undefined) {
        const [min, max] = condition.between;
        conditions.push(between(column, min, max));
      }

      if (condition.like !== undefined) {
        conditions.push(like(column, condition.like));
      }

      if (condition.notLike !== undefined) {
        conditions.push(notLike(column, condition.notLike));
      }

      if (condition.isNull === true) {
        conditions.push(isNull(column));
      }
    }

    return wrap ? sql.wrap(and([...conditions])) : and([...conditions]);
  }

  private _resolveOrderExpression<T extends AnyTable>(
    table: T,
    orderBy?: OrderByExpressionOf<T>
  ): SQLNode[] | undefined {
    const nodes: SQLNode[] = [];

    if (!orderBy) {
      return nodes;
    }

    for (const [key, direction] of Object.entries(orderBy)) {
      const column = table.getColumn(key);

      if (!column || !direction) {
        continue;
      }

      const node = sql.join([column, sql.raw(direction === "asc" ? "ASC" : "DESC")]);
      nodes.push(node);
    }

    return nodes.length > 0 ? nodes : undefined;
  }

  private _resolveInsertEntries<T extends AnyTable>(
    table: T,
    data: InsertRecordOf<T>[]
  ): [SQLNode[], SQLNode[][]] {
    const columns: SQLNode[] = [];
    const rows: SQLNode[][] = [];

    for (const record of data) {
      const row: SQLNode[] = [];

      for (const [key, value] of Object.entries(record)) {
        const column = table.getColumn(key);

        if (!column) {
          throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
        }

        columns.push(sql.identifier(column.name));
        row.push(sql.param(value));
      }

      rows.push(row);
    }

    return [columns, rows];
  }

  private _resolveUpdateEntries<T extends AnyTable>(
    table: T,
    data: UpdateRecordOf<T>
  ): [SQLNode, SQLNode][] {
    const entries: [SQLNode, SQLNode][] = [];

    for (const [key, value] of Object.entries(data)) {
      const column = table.getColumn(key);

      if (!column) {
        throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
      }

      if (column.primaryKey) {
        throw new Error(`Cannot update primary key column "${key}"`);
      }

      entries.push([sql.identifier(column.name), sql.param(value)]);
    }

    return entries;
  }

  private _resolveSelectParams<T extends AnyTable>(
    table: T,
    args: SelectArgs<T>,
    mode: OperationMode,
    resolvers: FieldResolver[] = []
  ): SelectParams & { resolvers: FieldResolver[] } {
    const fields = this._resolveFields(table, args.select);
    resolvers.push(...fields.resolvers);

    const where = args.where ? this._resolveWhereExpression(table, args.where) : undefined;
    const order = args.orderBy ? this._resolveOrderExpression(table, args.orderBy) : undefined;
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
    join: JoinExpressionOf<T, this["__type"]>,
    resolvers: FieldResolver[]
  ): JoinParams[] {
    const joins: JoinParams[] = [];

    if (!join || Object.keys(join).length === 0) {
      return joins;
    }

    for (const [key, value] of Object.entries(
      join as Record<string, boolean | SelectArgs<AnyTable, this["__type"]>>
    )) {
      const relation = table.getRelation(key);

      if (!relation) {
        throw new Error(`Relation "${key}" does not exist on table "${table.name}"`);
      }

      const targetTable = this._ctx.schema.getRelationTarget(table.name, key);

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

      let params: SelectParams | undefined = undefined;
      const joinResolvers: FieldResolver[] = [];

      if (typeof value === "boolean" && value === true) {
        params = this._resolveSelectParams(
          targetTable,
          { select: {} },
          relation.type === "has_many" ? "many" : "one",
          joinResolvers
        );
      } else if (typeof value === "object") {
        params = this._resolveSelectParams(
          targetTable,
          value,
          relation.type === "has_many" ? "many" : "one",
          joinResolvers
        );
      }

      if (params) {
        joins.push({
          alias: key,
          type: relation.type === "has_many" ? "many" : "one",
          from: fromColumn,
          to: toColumn,
          params: {
            ...params,
            where: params.where
              ? and([equals(toColumn, fromColumn), params.where])
              : equals(toColumn, fromColumn),
          },
        });
      }

      resolvers.push([key, joinResolvers]);
    }

    return joins;
  }

  public _createResultResolver<
    TTable extends AnyTable,
    TArgs extends SelectArgs<TTable, this["__type"]>,
    TMode extends OperationMode,
  >(
    resolvers: FieldResolver[],
    mode: TMode
  ): (rows: unknown[]) => OperationResult<TMode, SelectResult<TTable, this["__type"], TArgs>> {
    return (
      rows: unknown[]
    ): OperationResult<TMode, SelectResult<TTable, this["__type"], TArgs>> => {
      const results: SelectResult<TTable, this["__type"], TArgs>[] = [];

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

        results.push(result as SelectResult<TTable, this["__type"], TArgs>);
      }

      if (mode === "one") {
        return (results[0] ?? null) as OperationResult<
          TMode,
          SelectResult<TTable, this["__type"], TArgs>
        >;
      }

      return results as OperationResult<TMode, SelectResult<TTable, this["__type"], TArgs>>;
    };
  }

  public createSelect<
    TTable extends AnyTable,
    TArgs extends SelectArgs<TTable, this["__type"]>,
    TMode extends OperationMode,
  >(
    table: TTable,
    config: OperationOptions<TArgs, TMode>
  ): SelectOperation<
    TTable,
    SelectArgs<TTable>,
    OperationResult<TMode, SelectResult<TTable, this["__type"], TArgs>>
  > {
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
      resolve: this._createResultResolver<TTable, TArgs, TMode>(fieldResolvers, mode),
    };
  }

  public createInsert<TTable extends AnyTable>(
    table: TTable,
    config: OperationOptions<InsertArgs<TTable>>
  ): Prettify<InsertOperation<TTable, InsertArgs<TTable>, unknown>> {
    const { name, args } = config;

    const [columns, values] = this._resolveInsertEntries(
      table,
      Array.isArray(args.data) ? args.data : [args.data]
    );

    const selection = this._resolveFields(table, args.return);

    const query = this._ctx.dialect.buildInsertQuery({
      table,
      columns,
      values,
      return: selection.columns,
    });

    return {
      type: "insert",
      mode: "one",
      table: table,
      name: name ?? `insert_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver(selection.resolvers, "one"),
    };
  }

  public createUpdate<TTable extends AnyTable>(
    table: TTable,
    config: OperationOptions<UpdateArgs<TTable>>
  ): UpdateOperation<TTable, UpdateArgs<TTable>, unknown> {
    const { name, args } = config;

    const entries = this._resolveUpdateEntries(table, args.set);
    const where = args.where ? this._resolveWhereExpression(table, args.where) : undefined;
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
      mode: "one",
      name: name ?? `update_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver(selection.resolvers, "one"),
    };
  }

  public createDelete<TTable extends AnyTable>(
    table: TTable,
    config: OperationOptions<DeleteArgs<TTable>>
  ): DeleteOperation<TTable, DeleteArgs<TTable>, unknown> {
    const { name, args } = config;

    const where = args.where ? this._resolveWhereExpression(table, args.where) : undefined;
    const selection = this._resolveFields(table, args.return);

    const query = this._ctx.dialect.buildDeleteQuery({
      table,
      where,
      return: selection.columns,
    });

    return {
      type: "delete",
      table: table,
      mode: "one",
      name: name ?? `delete_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver(selection.resolvers, "one"),
    };
  }
}
