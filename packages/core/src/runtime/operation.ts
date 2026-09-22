import { TypedObject } from "../utils/index.js";
import { META_FIELD, Relation } from "../definition/index.js";
import { SQLIdentifier, SQLNode, SQLStatement, SQLValue, sql } from "../sql/index.js";
import { ExecutionContext } from "./context.js";
import { TenancyError } from "./errors.js";
import { AnyTable } from "./table.js";
import { AnyColumn } from "./column.js";
import { JoinParams, SelectParams } from "./query.js";
import { AnySchema } from "./base.js";

export type OperationType = "select" | "insert" | "update" | "delete";
export type OperationMode = "one" | "many";

export type OperationResult<TMode extends OperationMode, TResult> = TMode extends "one"
  ? TResult | null
  : TResult[];

export interface Operation<TMode extends OperationMode, TArgs extends object, TResult = unknown> {
  type: OperationType;
  mode: TMode;
  name: string;
  args: TArgs;
  query: SQLStatement;
  resolve: (rows: unknown[]) => OperationResult<TMode, TResult>;
}

export type AnyOperation = Operation<OperationMode, object, unknown>;

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

export type FieldMutation = [fieldName: string, value: SQLNode | SQLValue];

/**
 * How one field of a result record is produced from a driver row: read a column and decode
 * it, or resolve a nested level.
 */
export type FieldResolver = [fieldName: string, resolver: AnyColumn | ResolverEntry[]];

/**
 * How one field of a result record is produced from the driver row *itself*, rather than
 * from a column of it. `$$meta` is the only one today.
 *
 * The row passed in is the raw driver row, before any codec has decoded it — the same row
 * the column branch reads from. A resolver that needs the database's own text representation
 * of a value (rather than the decoded one) therefore has it.
 */
export type MetaResolver = [
  fieldName: string,
  resolve: (row: Record<string, unknown>) => unknown,
];

export type ResolverEntry = FieldResolver | MetaResolver;

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
  TArgs extends SelectOperationArgs,
  TReturn = unknown,
> extends Operation<TMode, TArgs, TReturn> {
  type: "select";
}

export interface InsertOperationArgs {
  data: FieldMutation[][];
  return?: FieldSelection[];
}

export interface InsertOperation<
  TMode extends OperationMode,
  TArgs extends InsertOperationArgs,
  TReturn,
> extends Operation<TMode, TArgs, TReturn> {
  type: "insert";
}

export interface UpdateOperationArgs {
  set: FieldMutation[];
  where?: SQLNode | SQLNode[];
  return?: FieldSelection[];
}

export interface UpdateOperation<
  TMode extends OperationMode,
  TArgs extends UpdateOperationArgs,
  TReturn = unknown,
> extends Operation<TMode, TArgs, TReturn> {
  type: "update";
}

export interface DeleteOperationArgs {
  where?: SQLNode | SQLNode[];
  return?: FieldSelection[];
}

export interface DeleteOperation<
  TMode extends OperationMode,
  TArgs extends DeleteOperationArgs = DeleteOperationArgs,
  TReturn = unknown,
> extends Operation<TMode, TArgs, TReturn> {
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

  /**
   * The tenant boundary for `table`, as a condition, or `undefined` when there is none to apply.
   *
   * A table with no claim columns is global and always yields `undefined`. Otherwise the
   * identity on the context decides: present, every claim becomes an equality on its column;
   * absent, an enforcing context refuses to build the operation at all, and a non-enforcing one
   * runs unscoped.
   *
   * The refusal is what makes this a boundary rather than a convenience. It fires here, below
   * the point where callers write queries, so it also covers a tenant table reached through a
   * join — which the types cannot see, because a nested level is named by a relation rather than
   * by the client.
   */
  private _tenantPredicate<T extends AnyTable>(table: T): SQLNode | undefined {
    if (table.tenantKeys.length === 0) {
      return undefined;
    }

    const identity = this._ctx.identity;

    if (!identity) {
      if (!this._ctx.tenancy.enforce) {
        return undefined;
      }

      throw new TenancyError(
        `Table "${table.name}" is tenant-scoped and this client carries no claims. ` +
          `Derive one with $identityClaims(), or create the client with ` +
          `tenancy: { enforce: false } if it is meant to run unscoped.`,
        table.name
      );
    }

    const conditions = table.tenantKeys.map(([claim, column]) => {
      const value = identity[claim];

      if (value === undefined || value === null) {
        throw new TenancyError(
          `Table "${table.name}" is scoped by claim "${claim}", which this client's identity ` +
            `does not carry.`,
          table.name,
          claim
        );
      }

      // Encoded by the column's own codec, so the predicate is written the way the column
      // stored the value — the same rule every other comparison follows.
      return sql.eq(column, column.param(value));
    });

    if (conditions.length === 1) {
      return conditions[0];
    }

    return sql.and(conditions.map((condition) => sql.wrap(condition)));
  }

  /**
   * The single place a `WHERE` is assembled, for every select — root and every nested join
   * level — every update and every delete. It is called unconditionally, even when the caller
   * passed no `where`, because this is the seam predicates are injected into: a rule that only
   * ran when the caller happened to filter would not be a rule.
   *
   * Several nodes are AND-ed, each wrapped so an `OR` among them keeps its precedence. A lone
   * node is returned untouched, so the common case adds no parentheses.
   *
   * The tenant predicate leads, before anything the caller wrote and before anything a sibling
   * feature appends afterwards (a join correlation, a keyset). Order is cosmetic to the planner
   * and deliberate to a reader: the boundary is the first thing an `EXPLAIN` shows.
   */
  private _resolveWhere<T extends AnyTable>(
    table: T,
    where?: SQLNode | SQLNode[]
  ): SQLNode | undefined {
    const conditions = [
      this._tenantPredicate(table),
      ...(Array.isArray(where) ? where : [where]),
    ].filter(
      (condition): condition is SQLNode => condition !== undefined && condition !== null
    );

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    return sql.and(conditions.map((condition) => sql.wrap(condition)));
  }

  private _validateOrderExpression<T extends AnyTable>(table: T, order: SQLNode[]): SQLNode[] {
    return order;
  }

  /**
   * Resolvers for one level of a result — the top level of a select, a join level, or a
   * `return` selection. Every level is built here, which is why stamping `$$meta` once at the
   * top of this function reaches all of them.
   */
  private _resolveFields<T extends AnyTable>(table: T, selection?: FieldSelection[]) {
    const columns: AnyColumn[] = [];
    const resolvers: ResolverEntry[] = [];

    // First, so `$$meta` leads every record. Resolvers only — it projects no SQL.
    resolvers.push([META_FIELD, () => table.meta]);

    if (!selection || selection.length === 0) {
      for (const [fieldName, column] of Object.entries<AnyColumn>(table.columns)) {
        columns.push(column);
        resolvers.push([fieldName, column]);
      }

      return { columns, resolvers };
    }

    for (const [fieldName, selected] of selection) {
      if (selected) {
        const column = table.columns[fieldName as keyof typeof table.columns];

        if (!column) {
          throw new Error(`Column "${fieldName}" does not exist on table "${table.name}"`);
        }

        columns.push(column);
        resolvers.push([fieldName, column]);
      }
    }

    return { columns, resolvers };
  }

  /**
   * The value a tenant claim column is inserted with, taken from the identity.
   *
   * Always required, in both modes: the column is `notNull` and nothing else can fill it, so an
   * insert without claims would write a row into no tenant. Moving a row between tenants is not
   * a model-client operation — it is raw SQL on an unscoped client, deliberately.
   */
  private _tenantValue<T extends AnyTable>(table: T, claim: string): unknown {
    const value = this._ctx.identity?.[claim];

    if (value === undefined || value === null) {
      throw new TenancyError(
        `Cannot insert into "${table.name}" without claim "${claim}": it is filled from the ` +
          `client's identity, and this client carries none.`,
        table.name,
        claim
      );
    }

    return value;
  }

  private _resolveInsertEntries<T extends AnyTable>(
    table: T,
    data: FieldMutation[][]
  ): [SQLNode[], SQLNode[][]] {
    const columns: SQLNode[] = [];
    const rows: SQLNode[][] = [];

    const columnEntries = table.getColumnEntries();

    for (const [, column] of columnEntries) {
      columns.push(new SQLIdentifier(column.name));
    }

    for (const record of data) {
      const row: SQLNode[] = [];
      const values = Object.fromEntries(record);

      for (const [fieldName, column] of columnEntries) {
        if (column.readOnly && values[fieldName] !== undefined) {
          throw new Error(`Cannot write read-only column "${fieldName}"`);
        }

        if (column.tenantKey) {
          row.push(column.getInsertValue(this._tenantValue(table, fieldName)));
          continue;
        }

        const value = column.getInsertValue(values[fieldName]);
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
      const column = table.getColumn(key);

      if (!column) {
        throw new Error(`Column "${key}" does not exist on table "${table.name}"`);
      }

      if (column.primaryKey) {
        throw new Error(`Cannot update primary key column "${key}"`);
      }

      if (column.readOnly) {
        throw new Error(`Cannot write read-only column "${key}"`);
      }

      const param = column.getUpdateValue(value);
      entries.push([new SQLIdentifier(column.name), param]);
    }

    return entries;
  }

  private _resolveSelectParams<T extends AnyTable>(
    table: T,
    args: SelectOperationArgs,
    mode: OperationMode,
    resolvers: ResolverEntry[] = []
  ) {
    const fields = this._resolveFields(table, args.select);
    resolvers.push(...fields.resolvers);

    const where = this._resolveWhere(table, args.where);
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
    resolvers: ResolverEntry[]
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

      if (relation.from.length === 0 || relation.from.length !== relation.to.length) {
        throw new Error(
          `Relation "${fieldName}" on table "${table.name}" must pair an equal, non-zero ` +
            `number of columns (got ${relation.from.length} from, ${relation.to.length} to)`
        );
      }

      const fromColumns = relation.from.map((ref) => {
        const column = table.getColumn(ref.name);

        if (!column) {
          throw new Error(
            `Invalid relation "${fieldName}" on table "${table.name}": missing column "${ref.name}"`
          );
        }

        return column;
      });

      const toColumns = relation.to.map((ref) => {
        const column = targetTable.getColumn(ref.name);

        if (!column) {
          throw new Error(
            `Invalid relation "${fieldName}" on table "${table.name}": missing column "${ref.name}" on target table "${targetTable.name}"`
          );
        }

        return column;
      });

      const joinResolvers: ResolverEntry[] = [];
      const params: SelectParams = this._resolveSelectParams(
        targetTable,
        value,
        relation.type === Relation.HAS_MANY ? "many" : "one",
        joinResolvers
      );

      // The correlation itself is the query builder's business: only it knows the alias each
      // level renders under, and a self-join needs the two sides aliased differently.
      joins.push({
        alias: fieldName,
        type: relation.type === "has_many" ? "many" : "one",
        from: fromColumns,
        to: toColumns,
        params,
      });

      resolvers.push([fieldName, joinResolvers]);
    }

    return joins;
  }

  public _createResultResolver<TMode extends OperationMode, TResult extends object>(
    resolvers: ResolverEntry[],
    mode: TMode
  ): (rows: unknown[]) => OperationResult<TMode, TResult> {
    return (rows: unknown[]): OperationResult<TMode, TResult> => {
      const results: TResult[] = [];

      for (const row of rows as Record<string, unknown>[]) {
        const result: Record<string, unknown> = {};

        for (const [fieldName, resolver] of resolvers) {
          if (typeof resolver === "function") {
            result[fieldName] = resolver(row);
            continue;
          }

          if (Array.isArray(resolver)) {
            const nestedRows = row[fieldName];

            if (typeof nestedRows === "undefined" || nestedRows === null) {
              result[fieldName] = null;
              continue;
            }

            const nestedResolver = this._createResultResolver(
              resolver,
              Array.isArray(nestedRows) ? "many" : "one"
            );

            result[fieldName] = nestedResolver(
              Array.isArray(nestedRows) ? nestedRows : [nestedRows]
            );

            continue;
          }

          result[fieldName] = resolver.resolve(row[resolver.name]);
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
  >(table: TTable, config: OperationRequest<TArgs, TMode>): SelectOperation<TMode, TArgs, TResult> {
    const { name, args, mode } = config;

    const { resolvers: fieldResolvers, ...params } = this._resolveSelectParams(table, args, mode);
    const query = this._ctx.dialect.buildSelectQuery(params);

    return {
      type: "select",
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
  >(table: TTable, config: OperationRequest<TArgs, TMode>): InsertOperation<TMode, TArgs, TResult> {
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
  >(table: TTable, config: OperationRequest<TArgs, TMode>): UpdateOperation<TMode, TArgs, TResult> {
    const { name, args, mode } = config;

    const entries = this._resolveUpdateEntries(table, args.set);
    const where = this._resolveWhere(table, args.where);
    const selection = this._resolveFields(table, args.return);

    const query = this._ctx.dialect.buildUpdateQuery({
      table,
      set: entries,
      where,
      return: selection.columns,
    });

    return {
      type: "update",
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
  >(table: TTable, config: OperationRequest<TArgs, TMode>): DeleteOperation<TMode, TArgs, TResult> {
    const { name, args, mode } = config;

    const where = this._resolveWhere(table, args.where);
    const selection = this._resolveFields(table, args.return);

    const query = this._ctx.dialect.buildDeleteQuery({
      table,
      where,
      return: selection.columns,
    });

    return {
      type: "delete",
      mode: config.mode,
      name: name ?? `delete_${table.name}`,
      args: args,
      query: query.toQuery(),
      resolve: this._createResultResolver<TMode, TResult>(selection.resolvers, mode),
    };
  }
}
