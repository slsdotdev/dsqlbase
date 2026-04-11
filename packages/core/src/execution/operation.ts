import { TableConfig } from "../definition/table.js";
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
import { AnyColumn } from "./column.js";
import { ExecutionContext } from "./context.js";
import { AnyTable, RecordOf, Table } from "./table.js";

export type OperationType = "select" | "insert" | "update" | "delete";

export interface Operation<
  TTable extends Table<string, TableConfig>,
  TArgs extends object,
  TReturn = unknown,
> {
  type: OperationType;
  table: TTable;
  name: string;
  args: TArgs;
  query: SQLStatement;
  parseResult: (rows: unknown[]) => TReturn;
}

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

export type WhereExpression<T extends Record<string, AnyColumn> = Record<string, AnyColumn>> =
  | { [K in keyof T]?: T[K] extends AnyColumn ? FilterCondition : never }
  | { and?: WhereExpression<T>[] }
  | { or?: WhereExpression<T>[] }
  | { not?: WhereExpression<T> };

interface SelectArgs<T extends AnyTable = AnyTable> {
  select: {
    [K in keyof T["columns"]]?: T["columns"][K] extends AnyColumn ? boolean : never;
  };
  where?: WhereExpression<T["columns"]>;
  distinct?: boolean;
  orderBy?: Record<string, OrderDirection>;
  limit?: number;
  offset?: number;
}

interface OperationOptions<TArgs extends object> {
  name?: string;
  args: TArgs;
}

export interface SelectOperation<
  TTable extends Table<string, TableConfig>,
  TArgs extends SelectArgs = SelectArgs,
  TReturn = unknown,
> extends Operation<TTable, TArgs, TReturn> {
  type: "select";
}

export class OperationFactory {
  private readonly _ctx: ExecutionContext;

  constructor(ctx: ExecutionContext) {
    this._ctx = ctx;
  }

  _resolveFields(table: AnyTable, selection?: Partial<Record<string, boolean>>): FieldSelection[] {
    const fields: FieldSelection[] = [];

    if (!selection) {
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

  _resolveWhereExpression(table: AnyTable, expression: WhereExpression): SQLNode {
    const conditions: SQLNode[] = [];

    if ("and" in expression && Array.isArray(expression["and"])) {
      const nodes = expression.and.map((expr) => this._resolveWhereExpression(table, expr));
      conditions.push(...nodes);
    }

    if ("or" in expression && Array.isArray(expression["or"])) {
      const nodes = expression.or.map((expr) => this._resolveWhereExpression(table, expr));
      conditions.push(or([...nodes]));
    }

    if ("not" in expression && expression.not) {
      const node = this._resolveWhereExpression(table, expression.not as WhereExpression);
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

    return and([...conditions]);
  }

  _resolveOrderExpression(
    table: AnyTable,
    orderBy?: Record<string, OrderDirection>
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

  createSelect<TTable extends AnyTable>(
    table: TTable,
    config: OperationOptions<SelectArgs<TTable>>
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
      parseResult: (rows) => rows as RecordOf<TTable>,
    };
  }
}
