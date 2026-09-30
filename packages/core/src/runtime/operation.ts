import { TypedObject } from "../utils/index.js";
import { AnyColumnDefinition, KEY_FIELD, META_FIELD, Relation } from "../definition/index.js";
import { KeysetBound, SQLIdentifier, SQLNode, SQLStatement, SQLValue, sql } from "../sql/index.js";
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

export type Operation<TMode extends OperationMode, TArgs extends object, TResult = unknown> = {
  type: OperationType;
  mode: TMode;
  name: string;
  args: TArgs;
  query: SQLStatement;
  resolve: (rows: unknown[]) => OperationResult<TMode, TResult>;
};

export type AnyOperation = Operation<OperationMode, object, unknown>;

export type OperationRequest<
  TArgs extends object,
  TMode extends OperationMode = OperationMode,
> = {
  name?: string;
  mode: TMode;
  args: TArgs;
};

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
/**
 * The field a union's primary-key tiebreaker is addressed by in its total order, followed by the
 * key column's position. Members may name their key columns differently, so a tiebreaker is
 * positional; `$` keeps it from ever meeting a real field.
 */
const PK_FIELD_PREFIX = "$$pk";

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
export type UnionOrderKey = {
  field: string;
  direction: "asc" | "desc";
  /** States Postgres's default null placement explicitly — see {@link KeysetKey.nullable}. */
  nullable?: boolean;
};

/**
 * A select over a union. `members` lists only the branches that run, each with its own
 * `select` / `where` / `join` already written against that member's columns; a member left out
 * produces no branch. Ordering, limit and offset apply across all of them.
 */
export type UnionSelectOperationArgs = {
  members: [alias: string, args: SelectOperationArgs][];
  orderBy?: UnionOrderKey[];
  limit?: number;
  offset?: number;
  /**
   * The direction of the keys appended to make the order total — `$$key` and the primary-key
   * tiebreakers. Ascending when omitted; a pager passes the direction of the caller's last key.
   */
  tiebreak?: "asc" | "desc";
  /**
   * Project every key of the total order a second time as its database text, as `__k0`,
   * `__k1`, ..., carried to the union level — the values a keyset cursor is built from. Root
   * level only.
   */
  keys?: boolean;
  /**
   * Read only the rows strictly after (or before) this position in the total order, applied
   * inside every branch where `$$key` is a constant. `before` also reverses the order.
   */
  keyset?: { values: (string | null)[]; bound: KeysetBound };
};

export type SelectOperationArgs = {
  /**
   * The columns to project. Omitted, every column; empty, none — a level that returns only its
   * joins.
   */
  select?: FieldSelection[];
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
};

export type SelectOperation<
  TMode extends OperationMode,
  TArgs extends SelectOperationArgs,
  TReturn = unknown,
> = {
  type: "select";
} & Operation<TMode, TArgs, TReturn>;

export type UnionSelectOperation<
  TMode extends OperationMode,
  TArgs extends UnionSelectOperationArgs,
  TReturn = unknown,
> = {
  type: "select";
} & Operation<TMode, TArgs, TReturn>;

/** A count over a union: the members that run, each with its own `where`. */
export type UnionCountOperationArgs = {
  members: [alias: string, args: { where?: SQLNode | SQLNode[] }][];
};

export type CountOperationArgs = {
  where?: SQLNode | SQLNode[];
};

export type CountOperation = {
  type: "select";
} & Operation<"one", CountOperationArgs | UnionCountOperationArgs, number>;

export type InsertOperationArgs = {
  data: FieldMutation[][];
  return?: FieldSelection[];
};

export type InsertOperation<
  TMode extends OperationMode,
  TArgs extends InsertOperationArgs,
  TReturn,
> = {
  type: "insert";
} & Operation<TMode, TArgs, TReturn>;

export type UpdateOperationArgs = {
  set: FieldMutation[];
  where?: SQLNode | SQLNode[];
  return?: FieldSelection[];
};

export type UpdateOperation<
  TMode extends OperationMode,
  TArgs extends UpdateOperationArgs,
  TReturn = unknown,
> = {
  type: "update";
} & Operation<TMode, TArgs, TReturn>;

export type DeleteOperationArgs = {
  where?: SQLNode | SQLNode[];
  return?: FieldSelection[];
};

export type DeleteOperation<
  TMode extends OperationMode,
  TArgs extends DeleteOperationArgs = DeleteOperationArgs,
  TReturn = unknown,
> = {
  type: "delete";
} & Operation<TMode, TArgs, TReturn>;

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
   *
   * No selection projects every column; an empty one projects none.
   */
  private _resolveFields<T extends AnyTable>(table: T, selection?: FieldSelection[]) {
    const columns: AnyColumn[] = [];
    const resolvers: ResolverEntry[] = [];

    // First, so `$$meta` leads every record. Resolvers only — it projects no SQL.
    resolvers.push([META_FIELD, () => table.meta]);

    // A column with a row decoder reads siblings of its row: they are projected with it — once,
    // however many columns need them — and the field is resolved from the whole row.
    const add = (fieldName: string, column: AnyColumn) => {
      if (!columns.includes(column)) {
        columns.push(column);
      }

      if (!column.rowDecoder) {
        resolvers.push([fieldName, column]);
        return;
      }

      for (const dependency of column.rowDecoder.dependsOn) {
        if (!columns.includes(dependency)) {
          columns.push(dependency);
        }
      }

      resolvers.push([fieldName, (row) => column.resolveRow(row)]);
    };

    if (!selection) {
      for (const [fieldName, column] of Object.entries<AnyColumn>(table.columns)) {
        add(fieldName, column);
      }

      return { columns, resolvers };
    }

    for (const [fieldName, selected] of selection) {
      if (selected) {
        const column = table.columns[fieldName as keyof typeof table.columns];

        if (!column) {
          throw new Error(`Column "${fieldName}" does not exist on table "${table.name}"`);
        }

        add(fieldName, column);
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
        const mode = relation.type === Relation.HAS_MANY ? "many" : "one";
        const union = this._resolveUnionParams(
          target,
          value as UnionSelectOperationArgs,
          mode,
          this._ctx.schema.getUnionRelationColumns(table.name, fieldName),
          this._ctx.schema.getRelationDiscriminator(table.name, fieldName)
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
    pairs?: Record<string, AnyColumn[]>,
    discriminator?: AnyColumn
  ): { params: UnionSelectParams; resolver: UnionResolver } {
    const orderBy = args.orderBy ?? [];
    const paged = args.keys === true || args.keyset !== undefined;
    const ordered = orderBy.length > 0 || paged;
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

    const tiebreakers = ordered ? union.tiebreakers : 0;

    if (paged && tiebreakers === 0) {
      throw new Error(
        `Cannot page union "${union.alias}": its members' primary keys differ in arity or type, ` +
          `so nothing can break a tie between two members' rows.`
      );
    }

    const order = ordered ? this._getUnionOrder(orderBy, tiebreakers, args.tiebreak) : [];
    const backward = args.keyset?.bound === "before";

    // A page read before its cursor runs every key the other way round; the keyset itself is
    // written against the order as given.
    const direction = (key: UnionOrderKey) => {
      const way = backward ? (key.direction === "asc" ? "desc" : "asc") : key.direction;
      const dir = way === "asc" ? "ASC" : "DESC";

      if (!key.nullable) {
        return dir;
      }

      return way === "asc" ? `${dir} NULLS LAST` : `${dir} NULLS FIRST`;
    };

    const branches: UnionBranchParams[] = [];
    const resolvers: Record<string, ResolverEntry[]> = {};

    for (const [alias, memberArgs] of args.members) {
      const member = union.getMember(alias);
      const memberResolvers: ResolverEntry[] = [];

      const expressions = order.map((key) => this._getUnionKeyExpression(union, alias, key));

      // The branch's own order, used only when it is limited. `$$key` is a constant inside a
      // branch, so it orders nothing there.
      const branchOrder =
        limit !== undefined && ordered
          ? order.flatMap((key, index) =>
              key.field === KEY_FIELD
                ? []
                : [sql`${expressions[index]} ${sql.raw(direction(key))}`]
            )
          : undefined;

      const keyset = args.keyset
        ? sql.keyset(
            order.map((key, index) => ({
              node: expressions[index],
              direction: key.direction,
              nullable: key.nullable,
            })),
            args.keyset.values,
            args.keyset.bound
          )
        : undefined;

      const params = this._resolveSelectParams(
        member,
        {
          ...memberArgs,
          where: [
            ...(Array.isArray(memberArgs.where) ? memberArgs.where : [memberArgs.where]),
            keyset,
          ].filter((node): node is SQLNode => node !== undefined && node !== null),
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
        ...order.flatMap((key, index) => {
          const hidden = this._getUnionKeyName(key, index);

          return hidden === KEY_FIELD
            ? []
            : [sql`${expressions[index]} AS ${sql.identifier(hidden)}`];
        }),
        // `::text` for the same reason as a table's keys: a cursor carries the database's own
        // rendering of each value.
        ...(args.keys
          ? expressions.map(
              (expression, index) => sql`${expression}::text AS ${sql.identifier(`__k${index}`)}`
            )
          : []),
      ];

      const { resolvers: branchResolvers, ...select } = params;

      branches.push({
        params: select,
        to: pairs?.[alias],
        // A belongs-to row names its member in the discriminator; only that member's branch may
        // match it, whatever ids the other members hold.
        correlate: discriminator ? [sql.eq(discriminator, sql.literal(alias))] : undefined,
      });
      resolvers[alias] = branchResolvers;
    }

    const carry = [
      ...order.map((key, index) => this._getUnionKeyName(key, index)),
      ...(args.keys ? order.map((_, index) => `__k${index}`) : []),
    ];

    return {
      params: {
        branches,
        carry,
        order: ordered
          ? order.map(
              (key, index) =>
                sql`${sql.identifier(this._getUnionKeyName(key, index))} ${sql.raw(direction(key))}`
            )
          : undefined,
        limit,
        offset,
      },
      resolver: new UnionResolver(mode, resolvers),
    };
  }

  /**
   * The total order of a union: the caller's keys, then `$$key` unless they named it, then
   * every primary-key column when the members' keys line up. The appended keys run in
   * `tiebreak` — ascending unless a pager asks otherwise.
   *
   * A primary-key tiebreaker is written as the field `$$pk<n>`: members may name their key
   * columns differently, so it is addressed by position rather than by field.
   */
  private _getUnionOrder(
    orderBy: UnionOrderKey[],
    tiebreakers: number,
    tiebreak: "asc" | "desc" = "asc"
  ): UnionOrderKey[] {
    return [
      ...orderBy,
      ...(orderBy.some((key) => key.field === KEY_FIELD)
        ? []
        : [{ field: KEY_FIELD, direction: tiebreak }]),
      ...Array.from({ length: tiebreakers }, (_, index) => ({
        field: `${PK_FIELD_PREFIX}${index}`,
        direction: tiebreak,
      })),
    ];
  }

  /** What one order key reads inside one member's branch. */
  private _getUnionKeyExpression(union: Union, alias: string, key: UnionOrderKey): SQLNode {
    if (key.field === KEY_FIELD) {
      return sql.literal(alias);
    }

    if (key.field.startsWith(PK_FIELD_PREFIX)) {
      return union.getMember(alias).primaryKey[Number(key.field.slice(PK_FIELD_PREFIX.length))];
    }

    return union.getMemberColumn(alias, key.field);
  }

  /**
   * The name one order key is carried under to the union level: `"$$key"` for `$$key`, which
   * every branch projects anyway, `__pk<n>` for a tiebreaker, `__o<n>` for a
   * caller's key — its position, since members may name the column differently.
   */
  private _getUnionKeyName(key: UnionOrderKey, index: number): string {
    if (key.field === KEY_FIELD) {
      return KEY_FIELD;
    }

    if (key.field.startsWith(PK_FIELD_PREFIX)) {
      return `__pk${key.field.slice(PK_FIELD_PREFIX.length)}`;
    }

    return `__o${index}`;
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

  /**
   * A top-level select over a union: the union's own `UNION ALL`, each row a JSON `data` value
   * dispatched to its member's resolvers. With no member left to run it reads nothing, and
   * resolves to `[]` or `null`.
   */
  public createUnionSelectOperation<
    TResult extends object,
    TMode extends OperationMode = OperationMode,
    TArgs extends UnionSelectOperationArgs = UnionSelectOperationArgs,
  >(union: Union, config: OperationRequest<TArgs, TMode>): UnionSelectOperation<TMode, TArgs, TResult> {
    const { name, args, mode } = config;
    const { params, resolver } = this._resolveUnionParams(union, args, mode);

    const query =
      params.branches.length > 0
        ? this._ctx.dialect.buildUnionSelectQuery(params)
        : sql`SELECT NULL::json AS ${sql.identifier("data")} WHERE false`;

    return {
      type: "select",
      mode,
      name: name ?? `select_${union.alias}`,
      args,
      query: query.toQuery(),
      resolve: (rows) =>
        this._resolveUnionRows(
          resolver,
          (rows as Record<string, unknown>[]).map((row) => row.data)
        ) as OperationResult<TMode, TResult>,
    };
  }

  /**
   * Counts the rows a union's members select: one `count(*)` per member, each through the
   * `WHERE` seam with that member's own table, added together.
   */
  public createUnionCountOperation(
    union: Union,
    config: OperationRequest<UnionCountOperationArgs, "one">
  ): CountOperation {
    const { name, args } = config;

    const counts = args.members.map(([alias, memberArgs]) => {
      const member = union.getMember(alias);
      const query = this._ctx.dialect.buildSelectQuery({
        table: member,
        select: [sql`count(*)`],
        where: this._resolveWhere(member, memberArgs.where),
      });

      return sql`(${query})`;
    });

    const total = counts.length > 0 ? sql.join(counts, " + ") : sql.raw("0");
    const query = sql`SELECT ${total} AS ${sql.identifier("count")}`;

    return {
      type: "select",
      mode: "one",
      name: name ?? `count_${union.alias}`,
      args,
      query: query.toQuery(),
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
