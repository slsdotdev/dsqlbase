import { TypedObject } from "../utils/index.js";
import { AnyColumnDefinition, KEY_FIELD, META_FIELD, Relation } from "../definition/index.js";
import { SQLIdentifier, SQLNode, SQLStatement, SQLValue, sql } from "../sql/index.js";
import { ExecutionContext } from "./context.js";
import { TenancyError } from "./errors.js";
import { AnyTable } from "./table.js";
import { AnyColumn } from "./column.js";
import { JoinParams, SelectParams, UnionBranchParams, UnionSelectParams } from "./query.js";
import { AnySchema } from "./base.js";
import { Union } from "./union.js";

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
export type FieldResolver = [
  fieldName: string,
  resolver: AnyColumn | ResolverEntry[] | UnionResolver,
];

/**
 * How a level whose rows come from several tables is resolved: each row names its member in
 * `$$key`, and that member's resolvers — `$$meta` included — produce the record.
 *
 * Dispatch decides *which* resolvers run for a row, so it happens before any field is read,
 * not after (`docs/decisions/0004-record-meta.md`). A member with no branch here was excluded
 * from the query, so a row naming it is a data-integrity failure and throws.
 */
export class UnionResolver {
  readonly mode: OperationMode;
  readonly branches: Readonly<Record<string, ResolverEntry[]>>;

  constructor(mode: OperationMode, branches: Record<string, ResolverEntry[]>) {
    this.mode = mode;
    this.branches = Object.freeze({ ...branches });
  }
}

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

/**
 * One order key across a union: a shared field, or `$$key` to sort by member. Structured
 * rather than a rendered `ORDER BY` term, because each member resolves the field to its own
 * column and the combined rows are then sorted by the hidden copy every branch projects.
 */
export interface UnionOrderKey {
  field: string;
  direction: "asc" | "desc";
  /** States Postgres's default null placement explicitly — see {@link KeysetKey.nullable}. */
  nullable?: boolean;
}

/**
 * A select over a union. `members` lists only the branches that run, each with its own
 * `select` / `where` / `join` already written against that member's columns; a member left out
 * produces no branch. Ordering, limit and offset apply across all of them.
 */
export interface UnionSelectOperationArgs {
  members: [alias: string, args: SelectOperationArgs][];
  orderBy?: UnionOrderKey[];
  limit?: number;
  offset?: number;
}

export interface SelectOperationArgs {
  select: FieldSelection[];
  where?: SQLNode | SQLNode[];
  orderBy?: SQLNode[];
  join?: [fieldName: string, args: SelectOperationArgs | UnionSelectOperationArgs][];
  distinct?: boolean;
  limit?: number;
  offset?: number;
  /**
   * Columns projected a second time as their database text, under the hidden names `__k0`,
   * `__k1`, ... — the order keys a keyset cursor is built from. They reach the raw driver row
   * only: no resolver reads them, so they never appear on a result record. Root level only.
   */
  keys?: AnyColumn[];
}

export interface SelectOperation<
  TMode extends OperationMode,
  TArgs extends SelectOperationArgs,
  TReturn = unknown,
> extends Operation<TMode, TArgs, TReturn> {
  type: "select";
}

export interface CountOperationArgs {
  where?: SQLNode | SQLNode[];
}

export interface CountOperation extends Operation<"one", CountOperationArgs, number> {
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

    // `::text` is the database's own rendering of the value, which a cursor carries verbatim —
    // a decoded JS value may have lost precision the database still compares on.
    const keys = (args.keys ?? []).map(
      (column, index) => sql`${column}::text AS ${sql.identifier(`__k${index}`)}`
    );

    return {
      table,
      select: [...fields.columns, ...keys],
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
    join: [SQLIdentifier | string, SelectOperationArgs | UnionSelectOperationArgs][],
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

      const target = this._ctx.schema.getRelationTarget(table.name, fieldName);
      const isUnionArgs = "members" in value;

      if (target instanceof Union !== isUnionArgs) {
        throw new Error(
          `Relation "${fieldName}" on table "${table.name}" targets ` +
            (target instanceof Union ? `union "${target.alias}"` : `table "${target.name}"`) +
            `, but was joined with arguments for ${isUnionArgs ? "a union" : "a table"}.`
        );
      }

      if (target instanceof Union) {
        if (relation.type === Relation.BELONGS_TO) {
          throw new Error(
            `Relation "${fieldName}" on table "${table.name}" belongs to union ` +
              `"${target.alias}"; joining a belongs-to a union is not supported yet.`
          );
        }

        const mode = relation.type === Relation.HAS_MANY ? "many" : "one";
        const union = this._resolveUnionParams(
          target,
          value as UnionSelectOperationArgs,
          mode,
          this._ctx.schema.getUnionRelationColumns(table.name, fieldName)
        );

        resolvers.push([fieldName, union.resolver]);

        // Every member pruned: no branch can match, so there is nothing to join. The resolver
        // still answers `[]` or `null` for the field.
        if (union.params.branches.length === 0) {
          continue;
        }

        joins.push({
          alias: fieldName,
          type: mode,
          from: this._resolveFromColumns(table, fieldName, relation.from),
          union: union.params,
        });

        continue;
      }

      const tableArgs = value as SelectOperationArgs;

      if (tableArgs.keys && tableArgs.keys.length > 0) {
        throw new Error(
          `Relation "${fieldName}" on table "${table.name}" cannot project keyset keys: only ` +
            `the root level of a select is keyset-ordered.`
        );
      }

      const targetTable = target;

      if (relation.from.length === 0 || relation.from.length !== relation.to.length) {
        throw new Error(
          `Relation "${fieldName}" on table "${table.name}" must pair an equal, non-zero ` +
            `number of columns (got ${relation.from.length} from, ${relation.to.length} to)`
        );
      }

      const fromColumns = this._resolveFromColumns(table, fieldName, relation.from);

      const toColumns = (relation.to as AnyColumnDefinition[]).map((ref) => {
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
        tableArgs,
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

  private _resolveFromColumns<T extends AnyTable>(
    table: T,
    fieldName: string,
    from: AnyColumnDefinition[]
  ): AnyColumn[] {
    return from.map((ref) => {
      const column = table.getColumn(ref.name);

      if (!column) {
        throw new Error(
          `Invalid relation "${fieldName}" on table "${table.name}": missing column "${ref.name}"`
        );
      }

      return column;
    });
  }

  /**
   * Builds the branches of a select over a union, one per member in `args.members`, each
   * through {@link _resolveSelectParams} with the member's own table — so every branch passes
   * the `WHERE` seam, tenant predicate included, and gets nested joins and codec-aware filters
   * exactly as a single-table level would. A branch cannot skip them, which is what keeps a
   * union from becoming a way around a member's tenant boundary.
   *
   * Each branch also projects:
   * - its alias as a `$$key` literal, which lands in the row's JSON and drives dispatch;
   * - when ordered, every order key as `__o<n>`, since members may name the column differently;
   * - when ordered and every member's primary key lines up (same arity, same types), those
   *   columns as `__pk<n>`, the tiebreakers after `$$key` that make the order total.
   *
   * With a `limit`, each branch is also ordered and limited to `limit + offset` rows. That is
   * safe because every branch sorts by the same keys the combined rows are sorted by, so no
   * row a branch drops could have made the combined page.
   *
   * `pairs` are the join's `to` columns per member; absent at the root of a query.
   */
  private _resolveUnionParams(
    union: Union,
    args: UnionSelectOperationArgs,
    mode: OperationMode,
    pairs?: Record<string, AnyColumn[]>
  ): { params: UnionSelectParams; resolver: UnionResolver } {
    const orderBy = args.orderBy ?? [];
    const ordered = orderBy.length > 0;
    const limit = mode === "one" ? 1 : args.limit;
    const offset = mode === "one" ? undefined : args.offset;

    for (const key of orderBy) {
      if (key.field !== KEY_FIELD && !union.isShared(key.field)) {
        throw new Error(
          `Cannot order union "${union.alias}" by "${key.field}": only fields every member ` +
            `shares, and ${KEY_FIELD}, order across a union.`
        );
      }
    }

    const tiebreakers = ordered ? this._getUnionTiebreakers(union) : 0;
    const direction = (key: { direction: "asc" | "desc"; nullable?: boolean }) => {
      const dir = key.direction === "asc" ? "ASC" : "DESC";

      if (!key.nullable) {
        return dir;
      }

      return key.direction === "asc" ? `${dir} NULLS LAST` : `${dir} NULLS FIRST`;
    };

    const branches: UnionBranchParams[] = [];
    const resolvers: Record<string, ResolverEntry[]> = {};

    for (const [alias, memberArgs] of args.members) {
      const member = union.getMember(alias);
      const memberResolvers: ResolverEntry[] = [];

      const orderColumns = orderBy.map((key) =>
        key.field === KEY_FIELD ? sql.literal(alias) : union.getMemberColumn(alias, key.field)
      );
      const pkColumns = member.primaryKey.slice(0, tiebreakers);

      // The branch's own order, used only when it is limited. `$$key` is a constant inside a
      // branch, so it orders nothing there.
      const branchOrder =
        limit !== undefined && ordered
          ? [
              ...orderBy.flatMap((key, index) =>
                key.field === KEY_FIELD
                  ? []
                  : [sql`${orderColumns[index]} ${sql.raw(direction(key))}`]
              ),
              ...pkColumns.map((column) => sql`${column} ASC`),
            ]
          : undefined;

      const params = this._resolveSelectParams(
        member,
        {
          ...memberArgs,
          orderBy: branchOrder,
          limit: limit !== undefined ? limit + (offset ?? 0) : undefined,
          offset: undefined,
        },
        "many",
        memberResolvers
      );

      params.select = [
        sql`${sql.literal(alias)} AS ${sql.identifier(KEY_FIELD)}`,
        ...params.select,
        ...orderColumns.map((column, index) => sql`${column} AS ${sql.identifier(`__o${index}`)}`),
        ...pkColumns.map((column, index) => sql`${column} AS ${sql.identifier(`__pk${index}`)}`),
      ];

      const { resolvers: branchResolvers, ...select } = params;

      branches.push({ params: select, to: pairs?.[alias] });
      resolvers[alias] = branchResolvers;
    }

    const carry = ordered
      ? [
          ...orderBy.map((_, index) => `__o${index}`),
          KEY_FIELD,
          ...Array.from({ length: tiebreakers }, (_, index) => `__pk${index}`),
        ]
      : [];

    const order = ordered
      ? [
          ...orderBy.map((key, index) =>
            key.field === KEY_FIELD
              ? sql`${sql.identifier(KEY_FIELD)} ${sql.raw(direction(key))}`
              : sql`${sql.identifier(`__o${index}`)} ${sql.raw(direction(key))}`
          ),
          ...(orderBy.some((key) => key.field === KEY_FIELD)
            ? []
            : [sql`${sql.identifier(KEY_FIELD)} ASC`]),
          ...Array.from(
            { length: tiebreakers },
            (_, index) => sql`${sql.identifier(`__pk${index}`)} ASC`
          ),
        ]
      : undefined;

    return {
      params: { branches, carry, order, limit, offset },
      resolver: new UnionResolver(mode, resolvers),
    };
  }

  /**
   * How many primary-key columns can break ties across a union: all of them when every member's
   * key has the same arity and the same types position by position, none otherwise — a
   * `UNION ALL` column must have one type across branches.
   */
  private _getUnionTiebreakers(union: Union): number {
    const keys = Object.values(union.members).map((member) => member.primaryKey);
    const [first] = keys;

    if (!first || first.length === 0) {
      return 0;
    }

    const aligned = keys.every(
      (key) =>
        key.length === first.length &&
        key.every((column, index) => column.dataType === first[index].dataType)
    );

    return aligned ? first.length : 0;
  }

  /** Resolves the rows of a union level, each by the member its `$$key` names. */
  private _resolveUnionRows(node: UnionResolver, value: unknown): unknown {
    if (value === undefined || value === null) {
      return node.mode === "many" ? [] : null;
    }

    const rows = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
    const results = rows.map((row) => {
      const key = row[KEY_FIELD] as string;
      const resolvers = node.branches[key];

      if (!resolvers) {
        throw new Error(
          `A union row names member "${String(key)}", which this query did not select ` +
            `(selected: ${Object.keys(node.branches).join(", ") || "none"}).`
        );
      }

      const record = this._createResultResolver<"one", Record<string, unknown>>(
        resolvers,
        "one"
      )([row]);

      return { [KEY_FIELD]: key, ...record };
    });

    return node.mode === "many" ? results : (results[0] ?? null);
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

          if (resolver instanceof UnionResolver) {
            result[fieldName] = this._resolveUnionRows(resolver, row[fieldName]);
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

  /**
   * `SELECT count(*)` over `table`, filtered by `where` through the same seam as every select,
   * so an injected predicate bounds the count exactly as it bounds the rows.
   */
  public createCountOperation<TTable extends AnyTable>(
    table: TTable,
    config: OperationRequest<CountOperationArgs, "one">
  ): CountOperation {
    const { name, args } = config;

    const query = this._ctx.dialect.buildSelectQuery({
      table,
      select: [sql`count(*) AS ${sql.identifier("count")}`],
      where: this._resolveWhere(table, args.where),
    });

    return {
      type: "select",
      mode: "one",
      name: name ?? `count_${table.name}`,
      args,
      query: query.toQuery(),
      // `count(*)` is a `bigint`, which drivers hand back as text (node-postgres) or `bigint`.
      resolve: (rows) => Number((rows[0] as { count?: unknown } | undefined)?.count ?? 0),
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
