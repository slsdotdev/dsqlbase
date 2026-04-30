import { TypedObject } from "@dsqlbase/core/utils";
import {
  AnyTable,
  DefinitionSchema,
  DeleteOperationArgs,
  ExecutionContext,
  FieldMutation,
  FieldSelection,
  InsertOperationArgs,
  OperationMode,
  OperationRequest,
  Schema,
  SelectOperationArgs,
  sql,
  SQLNode,
  SQLValue,
  UpdateOperationArgs,
} from "@dsqlbase/core";
import {
  AnyRelationQuery,
  CreateArgs,
  DeleteArgs,
  FieldSelectionOf,
  isFilterType,
  JoinExpressionOf,
  OrderByExpressionOf,
  QueryArgs,
  UpdateArgs,
  UpdateValuesOf,
  WhereExpressionOf,
} from "./base.js";

export class RequestNormalizer<TDefinition extends DefinitionSchema> implements TypedObject<
  Schema<TDefinition>
> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext;

  constructor(context: ExecutionContext) {
    this._ctx = context;
  }

  private _getWhereExpression<TTable extends AnyTable>(
    table: TTable,
    where: WhereExpressionOf<TTable> | null | undefined
  ): SQLNode | undefined {
    if (!where) {
      return undefined;
    }

    const expressions: SQLNode[] = [];

    for (const [fieldName, condition] of Object.entries(where)) {
      if (fieldName === "and" && Array.isArray(condition)) {
        const exp = sql.and(
          condition
            .map((expr) => this._getWhereExpression(table, expr))
            .filter(Boolean) as SQLNode[]
        );
        expressions.push(sql.wrap(exp));

        continue;
      }

      if (fieldName === "or" && Array.isArray(condition)) {
        const exp = sql.or(
          condition
            .map((expr) => this._getWhereExpression(table, expr))
            .filter(Boolean) as SQLNode[]
        );
        expressions.push(sql.wrap(exp));

        continue;
      }

      if (
        fieldName === "not" &&
        typeof condition === "object" &&
        condition !== null &&
        !Array.isArray(condition)
      ) {
        const shouldWrapNot = Object.keys(condition).length > 1;
        const expr = this._getWhereExpression(table, condition);

        if (expr) {
          expressions.push(shouldWrapNot ? sql.wrap(sql.not(expr)) : sql.not(expr));
        }

        continue;
      }

      const column = table.getColumn(fieldName);

      if (!column) {
        throw new Error(`Invalid field "${fieldName}" in where clause for table "${table.name}".`);
      }

      if (isFilterType(condition, "eq")) {
        expressions.push(sql.eq(column, condition.eq));
        continue;
      }

      if (isFilterType(condition, "neq")) {
        expressions.push(sql.ne(column, condition.neq));
        continue;
      }

      if (isFilterType(condition, "gt")) {
        expressions.push(sql.gt(column, condition.gt));
        continue;
      }

      if (isFilterType(condition, "gte")) {
        expressions.push(sql.gte(column, condition.gte));
        continue;
      }

      if (isFilterType(condition, "lt")) {
        expressions.push(sql.lt(column, condition.lt));
        continue;
      }

      if (isFilterType(condition, "lte")) {
        expressions.push(sql.lte(column, condition.lte));
        continue;
      }

      if (isFilterType(condition, "in")) {
        expressions.push(sql.in(column, condition.in));
        continue;
      }

      if (isFilterType(condition, "between")) {
        expressions.push(
          sql`${column} BETWEEN ${sql.param(condition.between[0])} AND ${sql.param(
            condition.between[1]
          )}`
        );
        continue;
      }

      if (isFilterType(condition, "exists")) {
        if (condition.exists) {
          expressions.push(sql.isNotNull(column));
        } else {
          expressions.push(sql.isNull(column));
        }
        continue;
      }

      if (isFilterType(condition, "beginsWith")) {
        expressions.push(sql.like(column, `${condition.beginsWith}%`));
        continue;
      }

      if (isFilterType(condition, "endsWith")) {
        expressions.push(sql.like(column, `%${condition.endsWith}`));
        continue;
      }

      if (isFilterType(condition, "contains")) {
        expressions.push(sql.like(column, `%${condition.contains}%`));
        continue;
      }

      expressions.push(sql.eq(column, condition as SQLValue));
    }

    return sql.and(expressions);
  }

  private _getSelectionEntries<TTable extends AnyTable>(
    table: TTable,
    selection: FieldSelectionOf<TTable> | boolean | null | undefined
  ): FieldSelection[] {
    const entries: FieldSelection[] = [];

    if (!selection || typeof selection === "boolean") {
      return entries;
    }

    for (const [fieldName, isSelected] of Object.entries(selection)) {
      if (isSelected) {
        const column = table.getColumn(fieldName);

        if (!column) {
          throw new Error(`Invalid field "${fieldName}" in selection for table "${table.name}".`);
        }

        entries.push([fieldName, column]);
      }
    }

    return entries;
  }

  private _getOrderByEntries<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): SQLNode[] | undefined {
    if (!orderBy) {
      return undefined;
    }

    const entries: SQLNode[] = [];

    for (const [fieldName, direction] of Object.entries(orderBy)) {
      const column = table.getColumn(fieldName);

      if (!column) {
        throw new Error(`Invalid field "${fieldName}" in orderBy for table "${table.name}".`);
      }

      if (direction === "asc") {
        entries.push(sql`${column} ASC`);
      } else if (direction === "desc") {
        entries.push(sql`${column} DESC`);
      }
    }

    return entries;
  }

  private _getJoinEntries<TTable extends AnyTable>(
    table: TTable,
    join: JoinExpressionOf<TTable, this["__type"]> | null | undefined
  ): [string, SelectOperationArgs][] | undefined {
    const entries: [string, SelectOperationArgs][] = [];

    if (!join || Object.keys(join).length === 0) {
      return undefined;
    }

    for (const [fieldName, query] of Object.entries(join as Record<string, AnyRelationQuery>)) {
      if (query === null || query === undefined || (typeof query === "boolean" && !query)) {
        continue;
      }

      const targetTable = this._ctx.schema.getRelationTarget(table.name, fieldName);

      if (!targetTable) {
        throw new Error(
          `Relation "${fieldName}" in table "${table.name}" does not have a valid target table.`
        );
      }

      const params = this._getSelectArgs(targetTable, query === true ? {} : query);
      entries.push([fieldName, params]);
    }

    return entries;
  }

  private _getMutationEntries<TTable extends AnyTable>(
    table: TTable,
    values: UpdateValuesOf<TTable>
  ): FieldMutation[] {
    const entries: FieldMutation[] = [];

    for (const [fieldName, value] of Object.entries(values as Record<string, SQLValue>)) {
      const column = table.getColumn(fieldName);

      if (!column) {
        throw new Error(`Invalid field "${fieldName}" in update values for table "${table.name}".`);
      }

      entries.push([fieldName, value]);
    }

    return entries;
  }

  private _getSelectArgs<TTable extends AnyTable>(
    table: TTable,
    args: QueryArgs<TTable, this["__type"]>
  ): SelectOperationArgs {
    const selection = this._getSelectionEntries(table, args.select);
    const where = this._getWhereExpression(table, args.where);
    const join = this._getJoinEntries(table, args.join);
    const orderBy = this._getOrderByEntries(table, args.orderBy);

    return {
      select: selection,
      where,
      join,
      orderBy,
      distinct: args.distinct,
      limit: args.limit,
      offset: args.offset,
    };
  }

  public normalizeSelect<
    TTable extends AnyTable,
    TArgs extends QueryArgs<TTable, this["__type"]>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<SelectOperationArgs, TMode> {
    return {
      mode,
      args: this._getSelectArgs(table, args),
    };
  }

  public normalizeInsert<
    TTable extends AnyTable,
    TArgs extends CreateArgs<TTable>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<InsertOperationArgs, TMode> {
    const values = this._getMutationEntries(table, args.data);
    const returning = this._getSelectionEntries(table, args.return);

    return {
      mode,
      args: {
        data: [values],
        return: returning,
      },
    };
  }

  public normalizeUpdate<
    TTable extends AnyTable,
    TArgs extends UpdateArgs<TTable>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<UpdateOperationArgs, TMode> {
    const values = this._getMutationEntries(table, args.set);
    const where = this._getWhereExpression(table, args.where);
    const returning = this._getSelectionEntries(table, args.return);

    return {
      mode,
      args: {
        set: values,
        where,
        return: returning,
      },
    };
  }

  public normalizeDelete<
    TTable extends AnyTable,
    TArgs extends DeleteArgs<TTable>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<DeleteOperationArgs, TMode> {
    const where = this._getWhereExpression(table, args.where);
    const returning = this._getSelectionEntries(table, args.return);

    return {
      mode,
      args: {
        where,
        return: returning,
      },
    };
  }
}
