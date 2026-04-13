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
import { Prettify, UnionToIntersection } from "../types/prettify.js";
import { AnyColumn } from "./column.js";
import { ExecutionContext } from "./context.js";
import { AnyTable, RecordOf, Table } from "./table.js";
import { AnySchema, SchemaRelationsOf } from "./types.js";

export type OrderDirection = "asc" | "desc";

export interface FieldSelection {
  path: string[];
  column: AnyColumn;
  alias?: string;
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
      [K in keyof UnionToIntersection<T["__type"]["relations"]>]?: UnionToIntersection<
        T["__type"]["relations"]
      >[K] extends Relation<
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
  distinct?: boolean;
  limit?: number;
  offset?: number;
  join?: JoinExpressionOf<T, TSchema>;
}

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

export interface Operation<TTable extends AnyTable, TArgs extends object, TReturn = unknown> {
  type: OperationType;
  table: TTable;
  name: string;
  args: TArgs;
  query: SQLStatement;
  resolve: (rows: unknown[]) => TReturn;
}

interface OperationOptions<TArgs extends object> {
  name?: string;
  args: TArgs;
}

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
  ): FieldSelection[] {
    const fields: FieldSelection[] = [];

    if (!selection || Object.keys(selection).length === 0) {
      for (const [key, column] of Object.entries(table.columns)) {
        fields.push({
          path: [key],
          column: column,
        });
      }

      return fields;
    }

    for (const [key, selected] of Object.entries(selection)) {
      if (selected) {
        const column = table.columns[key];
        if (!column) {
          throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
        }

        fields.push({
          path: [key],
          column: column,
        });
      }
    }

    return fields;
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

  private _resolveJoinEntries<T extends AnyTable>(
    table: T,
    join?: JoinExpressionOf<T, this["__type"]>
  ): SQLNode[] {
    if (!join || Object.keys(join).length === 0) {
      return [];
    }

    return [];
  }

  public createSelect<TTable extends AnyTable, TArgs extends SelectArgs<TTable, this["__type"]>>(
    table: TTable,
    config: OperationOptions<TArgs>
  ): SelectOperation<TTable, SelectArgs<TTable>, RecordOf<TTable>> {
    const { name, args } = config;

    const fields = this._resolveFields(table, args.select);
    const where = args.where ? this._resolveWhereExpression(table, args.where) : undefined;
    const order = args.orderBy ? this._resolveOrderExpression(table, args.orderBy) : undefined;

    const query = this._ctx.dialect.buildSelectQuery({
      table,
      select: fields.map(({ column }) => column),
      distinct: args.distinct,
      where,
      order: order,
      limit: args.limit,
      offset: args.offset,
    });

    return {
      type: "select",
      table: table,
      name: name ?? `select_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: (rows) => rows as RecordOf<TTable>,
    } as SelectOperation<TTable, SelectArgs<TTable>, RecordOf<TTable>>;
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
      return: selection.map(({ column }) => column),
    });

    return {
      type: "insert",
      table: table,
      name: name ?? `insert_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: (rows) => rows,
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
      return: selection.map(({ column }) => column),
    });

    return {
      type: "update",
      table: table,
      name: name ?? `update_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: (rows) => rows,
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
      return: selection.map(({ column }) => column),
    });

    return {
      type: "delete",
      table: table,
      name: name ?? `delete_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: (rows) => rows,
    };
  }
}
