import { TypedObject } from "@dsqlbase/core/utils";
import {
  AnyColumn,
  AnyTable,
  CountOperationArgs,
  DefinitionSchema,
  DeleteOperationArgs,
  ExecutionContext,
  FieldMutation,
  FieldSelection,
  InsertOperationArgs,
  KeysetBound,
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
  CountArgs,
  CreateArgs,
  DeleteArgs,
  FieldSelectionOf,
  isFilterType,
  JoinExpressionOf,
  OrderByExpressionOf,
  PaginateArgs,
  QueryArgs,
  UpdateArgs,
  UpdateValuesOf,
  WhereExpressionOf,
} from "./base.js";
import {
  CursorKey,
  decodeCursor,
  InvalidCursorError,
  keysetSignature,
} from "../pagination/cursor.js";

/** The page size when neither the call nor the client names one. */
export const DEFAULT_PAGE_SIZE = 100;

interface OrderKey {
  field: string;
  column: AnyColumn;
  direction: "asc" | "desc";
  /** Set on a page's keys only: whether the key can hold `NULL`, so its nulls must be placed. */
  nullable?: boolean;
}

const flip = (direction: "asc" | "desc"): "asc" | "desc" => (direction === "asc" ? "desc" : "asc");

/** Everything `paginate` needs besides the select itself. */
export interface PaginateRequest {
  request: OperationRequest<SelectOperationArgs, "many">;
  /** The caller's own filter, without the keyset — what a count of the same rows uses. */
  where?: SQLNode;
  /** The total order, as the cursor signs it: the caller's keys, then the primary key. */
  keys: CursorKey[];
  signature: string;
  /** The page size. The select reads one row more, to learn whether another page follows. */
  take: number;
  bound: KeysetBound;
  /** The key values of the cursor row, when the call passed a cursor. */
  cursor?: (string | null)[];
}

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
      if ((fieldName === "and" || fieldName === "or") && Array.isArray(condition)) {
        const children = condition
          .map((expr) => this._getWhereExpression(table, expr))
          .filter(Boolean) as SQLNode[];

        // An empty group constrains nothing; left in, it would render as `()`.
        if (children.length > 0) {
          expressions.push(sql.wrap(fieldName === "and" ? sql.and(children) : sql.or(children)));
        }

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

      // Comparison values go through `column.param` so the column's codec writes them the
      // same way it wrote them on insert. Pattern operators below stay raw: they compare
      // against a `LIKE` pattern, not a column value.
      if (isFilterType(condition, "eq")) {
        expressions.push(sql.eq(column, column.param(condition.eq)));
        continue;
      }

      if (isFilterType(condition, "neq")) {
        expressions.push(sql.ne(column, column.param(condition.neq)));
        continue;
      }

      if (isFilterType(condition, "gt")) {
        expressions.push(sql.gt(column, column.param(condition.gt)));
        continue;
      }

      if (isFilterType(condition, "gte")) {
        expressions.push(sql.gte(column, column.param(condition.gte)));
        continue;
      }

      if (isFilterType(condition, "lt")) {
        expressions.push(sql.lt(column, column.param(condition.lt)));
        continue;
      }

      if (isFilterType(condition, "lte")) {
        expressions.push(sql.lte(column, column.param(condition.lte)));
        continue;
      }

      if (isFilterType(condition, "in")) {
        expressions.push(sql.in(column, condition.in.map((value) => column.param(value))));
        continue;
      }

      if (isFilterType(condition, "between")) {
        expressions.push(
          sql`${column} BETWEEN ${column.param(condition.between[0])} AND ${column.param(
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

      // Value shorthand: `{ id: "123" }` means `{ id: { eq: "123" } }`.
      expressions.push(sql.eq(column, column.param(condition as SQLValue)));
    }

    // `{}` selects everything, the same as no `where` at all — not an empty `WHERE`.
    return expressions.length > 0 ? sql.and(expressions) : undefined;
  }

  /**
   * The `where` of an operation that requires one — `findOne`, `update`, `delete` — refusing a
   * filter that selects nothing in particular. `{}` means "every row" everywhere else; here it
   * would pick an arbitrary row to read, or every row to change.
   */
  private _getRequiredWhere<TTable extends AnyTable>(
    table: TTable,
    where: WhereExpressionOf<TTable> | null | undefined,
    operation: string
  ): SQLNode {
    const expression = this._getWhereExpression(table, where);

    if (!expression) {
      throw new Error(
        `${operation} on "${table.name}" needs a where that names the rows it applies to; ` +
          `an empty one would match every row.`
      );
    }

    return expression;
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

  /** `orderBy` as resolved keys, in the order the caller wrote them. */
  private _getOrderKeys<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): OrderKey[] {
    const keys: OrderKey[] = [];

    for (const [field, direction] of Object.entries(orderBy ?? {})) {
      const column = table.getColumn(field);

      if (!column) {
        throw new Error(`Invalid field "${field}" in orderBy for table "${table.name}".`);
      }

      if (direction === "asc" || direction === "desc") {
        keys.push({ field, column, direction });
      }
    }

    return keys;
  }

  /**
   * `ORDER BY` terms. A nullable page key states its null placement — Postgres's own default,
   * last ascending and first descending — so the order never depends on a server setting and
   * always agrees with the keyset predicate. Flipping a direction flips the placement with it,
   * which is what makes a page read backwards the exact reverse of one read forwards.
   */
  private _renderOrderKeys(keys: OrderKey[]): SQLNode[] {
    return keys.map(({ column, direction, nullable }) => {
      if (!nullable) {
        return direction === "asc" ? sql`${column} ASC` : sql`${column} DESC`;
      }

      return direction === "asc" ? sql`${column} ASC NULLS LAST` : sql`${column} DESC NULLS FIRST`;
    });
  }

  private _getOrderByEntries<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): SQLNode[] | undefined {
    if (!orderBy) {
      return undefined;
    }

    return this._renderOrderKeys(this._getOrderKeys(table, orderBy));
  }

  /**
   * The total order a page is read under: the caller's keys, then every primary-key column
   * they did not already name, so no two rows ever tie. An appended key follows the direction
   * of the last one the caller wrote — `asc` when they wrote none.
   */
  private _getKeysetOrder<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): OrderKey[] {
    if (table.primaryKey.length === 0) {
      throw new Error(
        `Cannot paginate "${table.name}": it has no primary key to break ties between rows.`
      );
    }

    const keys = this._getOrderKeys(table, orderBy);
    const direction = keys.at(-1)?.direction ?? "asc";

    const fields = new Map(table.getColumnEntries().map(([field, column]) => [column, field]));

    for (const column of table.primaryKey) {
      if (!keys.some((key) => key.column === column)) {
        keys.push({ field: fields.get(column) as string, column, direction });
      }
    }

    // A primary-key column cannot hold NULL, whether or not it was also marked notNull.
    return keys.map((key) => ({
      ...key,
      nullable: !key.column.notNull && !table.primaryKey.includes(key.column),
    }));
  }

  private _getPageSize(limit: number | undefined): number {
    const { defaultLimit = DEFAULT_PAGE_SIZE, maxLimit } = this._ctx.pagination ?? {};
    const size = limit ?? defaultLimit;

    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`A page size must be a positive integer (got ${String(size)}).`);
    }

    if (maxLimit !== undefined && size > maxLimit) {
      throw new Error(`A page size of ${size} exceeds this client's maxLimit of ${maxLimit}.`);
    }

    return size;
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

      // Read-only columns are dropped rather than refused: the types already exclude them, so a
      // value here arrived through an untyped spread, and whatever owns the column wins anyway.
      if (column.readOnly) {
        continue;
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
    const request = this._getSelectArgs(table, args);

    // `findOne` requires a where by type; one that selects nothing in particular is refused.
    if (mode === "one") {
      request.where = this._getRequiredWhere(table, args.where, "findOne");
    }

    return { mode, args: request };
  }

  /**
   * A page read: the select to run, plus everything needed to turn its rows into a page.
   *
   * The keyset predicate is appended to the caller's `where` as a second condition, so the
   * seam in core renders the tenant predicate, then the caller's filter, then the keyset. The
   * caller's filter alone is kept apart as `where`, for a count over the same rows.
   */
  public normalizePaginate<
    TTable extends AnyTable,
    TArgs extends PaginateArgs<TTable, this["__type"]>,
  >(table: TTable, args: TArgs): PaginateRequest {
    const { after, before } = args;

    if (after != null && before != null) {
      throw new Error("Pass either after or before, not both.");
    }

    const take = this._getPageSize(args.limit);
    const keys = this._getKeysetOrder(table, args.orderBy);
    const signature = keysetSignature(table.alias, keys);
    const bound = before != null ? "before" : "after";
    const token = after ?? before ?? undefined;

    let cursor: (string | null)[] | undefined;

    if (token !== undefined) {
      cursor = decodeCursor(token, signature, keys.length);

      if (cursor.some((value, index) => value === null && !keys[index].nullable)) {
        throw new InvalidCursorError(
          "format",
          `"${token}" carries a null for a key that cannot hold one.`
        );
      }
    }

    const base = this._getSelectArgs(table, { select: args.select, join: args.join });
    const where = this._getWhereExpression(table, args.where);
    const keyset = cursor
      ? sql.keyset(
          keys.map(({ column, direction, nullable }) => ({ node: column, direction, nullable })),
          cursor,
          bound
        )
      : undefined;

    // A page before the cursor is read backwards — every direction flipped — and put back in
    // order once it is resolved, so the rows nearest the cursor are the ones kept.
    const order =
      bound === "before" ? keys.map((key) => ({ ...key, direction: flip(key.direction) })) : keys;

    return {
      request: {
        mode: "many",
        args: {
          ...base,
          where: [where, keyset].filter((node): node is SQLNode => node !== undefined),
          orderBy: this._renderOrderKeys(order),
          keys: keys.map(({ column }) => column),
          limit: take + 1,
        },
      },
      where,
      keys: keys.map(({ field, direction }) => ({ field, direction })),
      signature,
      take,
      bound,
      cursor,
    };
  }

  /** A count over the rows `where` selects. */
  public normalizeCount<TTable extends AnyTable>(
    table: TTable,
    args: CountArgs<TTable> = {}
  ): OperationRequest<CountOperationArgs, "one"> {
    return {
      mode: "one",
      args: { where: this._getWhereExpression(table, args.where) },
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
    const where = this._getRequiredWhere(table, args.where, "update");
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
    const where = this._getRequiredWhere(table, args.where, "delete");
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
