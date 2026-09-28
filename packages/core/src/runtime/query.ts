import { sql, SQLNode, SQLQuery } from "../sql/index.js";
import { SQLScope } from "../sql/nodes.js";

export interface TableJoinParams {
  alias: string;
  type: "one" | "many";
  /** Columns on the parent level. Paired positionally with {@link TableJoinParams.to}. */
  from: SQLNode[];
  /** Columns on the joined level. Paired positionally with {@link TableJoinParams.from}. */
  to: SQLNode[];
  params: SelectParams;
}

/** One member of a `UNION ALL`: its own select, and — inside a join — its own `to` columns. */
export interface UnionBranchParams {
  params: SelectParams;
  /** Paired positionally with the join's `from`. Absent at the root of a query. */
  to?: SQLNode[];
}

/**
 * A `UNION ALL` over the members of a union, each branch wrapped so it yields one JSON `data`
 * column — members differ in columns, so their rows can only be combined as JSON.
 *
 * `carry` names hidden columns every branch projects (order keys, `$$key`, primary-key
 * tiebreakers) that are lifted next to `data` so `order` can sort the combined rows by them.
 */
export interface UnionSelectParams {
  branches: UnionBranchParams[];
  carry: string[];
  /** Sorts the combined rows; written over the carried names, never over a table column. */
  order?: SQLNode[];
  limit?: number;
  offset?: number;
}

export interface UnionJoinParams {
  alias: string;
  type: "one" | "many";
  /** Columns on the parent level, paired with each branch's `to`. */
  from: SQLNode[];
  union: UnionSelectParams;
}

export type JoinParams = TableJoinParams | UnionJoinParams;

/**
 * Hands out the table and JSON-wrapper aliases for one query build. Kept per build rather
 * than on the builder so `QueryBuilder` stays stateless and safe to share across a client.
 */
interface AliasAllocator {
  table(): string;
  json(): string;
  union(): string;
}

const createAliasAllocator = (): AliasAllocator => {
  let tables = 0;
  let wrappers = 0;
  let unions = 0;

  return {
    table: () => `__t${tables++}`,
    json: () => `__j${wrappers++}`,
    union: () => `__u${unions++}`,
  };
};

export interface SelectParams {
  table: SQLNode;
  select: SQLNode[];
  where?: SQLNode;
  order?: SQLNode[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  join?: JoinParams[];
}

export interface InsertParams {
  table: SQLNode;
  columns: SQLNode[];
  values: SQLNode[][];
  return?: SQLNode[];
}

export interface UpdateParams {
  table: SQLNode;
  set: [column: SQLNode, value: SQLNode][];
  where?: SQLNode;
  return?: SQLNode[];
}

export interface DeleteParams {
  table: SQLNode;
  where?: SQLNode;
  return?: SQLNode[];
}

export class QueryBuilder {
  private _getSelection(columns: SQLNode[], joinFields: string[]): SQLNode {
    const selection: SQLNode[] = [...columns];

    if (columns.length === 0 && joinFields.length === 0) {
      return sql`*`;
    }

    for (const field of joinFields) {
      const alias = sql.identifier(`__join_${field}`);
      const node = sql`${alias}.${sql.identifier("data")} AS ${sql.identifier(field)}`;

      selection.push(node);
    }

    return sql.join(selection, ", ");
  }

  /**
   * Correlates a joined level to its parent, over every column pair.
   *
   * The parent-side columns are wrapped in the parent's scope so they keep the parent's
   * alias even though the predicate is rendered inside the joined level, where the same
   * table may be bound to a different alias. That is what makes a self-join correct.
   */
  private _buildCorrelation(
    alias: string,
    from: SQLNode[],
    to: SQLNode[],
    parentScope: ReadonlyMap<unknown, string>
  ): SQLNode {
    if (from.length === 0 || from.length !== to.length) {
      throw new Error(
        `Join "${alias}" must correlate an equal, non-zero number of columns ` +
          `(got ${from.length} from, ${to.length} to)`
      );
    }

    const pairs = to.map((column, index) => sql.eq(column, new SQLScope(parentScope, from[index])));

    return pairs.length === 1 ? pairs[0] : sql.and(pairs);
  }

  /**
   * Builds a lateral join for the given join parameters. This is used to implement relations
   * between tables.
   *
   * @example
   * Given a `tasks` table with a relation to an `assignee` in the `users` table, the join
   * produces:
   *
   * ```sql
   * SELECT "__t0"."id", "__join_assignee"."data" AS "assignee" FROM "tasks" AS "__t0"
   *  LEFT JOIN LATERAL (
   *    SELECT row_to_json("__j0".*) AS "data"
   *      FROM (
   *        SELECT "__t1"."name"
   *        FROM "users" AS "__t1"
   *        WHERE "__t1"."id" = "__t0"."assignee_id"
   *      ) AS "__j0"
   *  ) AS "__join_assignee"
   * ON true
   * ```
   **/
  private _buildLateralJoin(
    join: JoinParams,
    parentScope: ReadonlyMap<unknown, string>,
    alloc: AliasAllocator
  ): SQLNode {
    if ("union" in join) {
      return this._buildUnionLateralJoin(join, parentScope, alloc);
    }

    const alias = sql.identifier(`__join_${join.alias}`);
    const innerAlias = sql.identifier(alloc.json());

    const correlation = this._buildCorrelation(join.alias, join.from, join.to, parentScope);
    const where = this._withCondition(correlation, join.params.where);

    const innerQuery = this._buildSelect({ ...join.params, where }, alloc);

    const subquery = sql`SELECT`;

    if (join.type === "many") {
      subquery.append(sql` COALESCE(json_agg(row_to_json(${innerAlias}.*)), '[]'::json)`);
    } else {
      subquery.append(sql` row_to_json(${innerAlias}.*)`);
    }

    subquery.append(sql` AS ${sql.identifier("data")} FROM (${innerQuery}) AS ${innerAlias}`);

    return sql`LEFT JOIN LATERAL (${subquery}) AS ${alias} ON true`;
  }

  /** `condition AND (where)`, or `condition` alone when there is no `where`. */
  private _withCondition(condition: SQLNode, where?: SQLNode): SQLNode {
    return where ? sql.and([condition, sql.wrap(where)]) : condition;
  }

  /**
   * Renders a `UNION ALL` over a union's branches. Each branch is its own full select —
   * aliased, filtered, ordered and limited like any level — wrapped as one JSON `data` column
   * plus the carried hidden columns, because members share no column list:
   *
   * ```sql
   * SELECT row_to_json("__j1".*) AS "data", "__j1"."__o0", "__j1"."$$key", "__j1"."__pk0"
   *   FROM (SELECT 'photos' AS "$$key", ... FROM "photos" AS "__t1" ...) AS "__j1"
   * UNION ALL
   * SELECT row_to_json("__j2".*) AS "data", ... FROM (SELECT 'videos' AS "$$key", ...) AS "__j2"
   * ORDER BY "__o0" DESC, "$$key" ASC, "__pk0" ASC LIMIT $1
   * ```
   *
   * `correlate` adds a branch's join correlation to its `WHERE`, inside that branch, where its
   * own alias is in scope.
   */
  private _buildUnion(
    union: UnionSelectParams,
    alloc: AliasAllocator,
    correlate?: (branch: UnionBranchParams) => SQLNode
  ): SQLQuery {
    const parts = union.branches.map((branch) => {
      const where = correlate
        ? this._withCondition(correlate(branch), branch.params.where)
        : branch.params.where;

      const inner = this._buildSelect({ ...branch.params, where }, alloc);
      const wrapper = sql.identifier(alloc.json());

      const columns = [
        sql`row_to_json(${wrapper}.*) AS ${sql.identifier("data")}`,
        ...union.carry.map((name) => sql`${wrapper}.${sql.identifier(name)}`),
      ];

      return sql`SELECT ${sql.join(columns, ", ")} FROM (${inner}) AS ${wrapper}`;
    });

    const query = sql`${sql.join(parts, " UNION ALL ")}`;

    if (union.order && union.order.length > 0) {
      query.append(sql` ORDER BY ${sql.join(union.order, ", ")}`);
    }

    if (union.limit !== undefined) {
      query.append(sql` LIMIT ${sql.param(union.limit)}`);
    }

    if (union.offset !== undefined) {
      query.append(sql` OFFSET ${sql.param(union.offset)}`);
    }

    return query;
  }

  /**
   * A lateral join to a union: the union's `UNION ALL`, correlated per branch, aggregated
   * like any join — `json_agg` of the `data` column in the union's order for has-many, the one
   * `data` value for has-one and belongs-to.
   */
  private _buildUnionLateralJoin(
    join: UnionJoinParams,
    parentScope: ReadonlyMap<unknown, string>,
    alloc: AliasAllocator
  ): SQLNode {
    const alias = sql.identifier(`__join_${join.alias}`);
    const unionAlias = sql.identifier(alloc.union());

    const union = this._buildUnion(join.union, alloc, (branch) =>
      this._buildCorrelation(join.alias, join.from, branch.to ?? [], parentScope)
    );

    const data = sql`${unionAlias}.${sql.identifier("data")}`;
    const subquery = sql`SELECT`;

    if (join.type === "many") {
      const order =
        join.union.order && join.union.order.length > 0
          ? sql` ORDER BY ${sql.join(join.union.order, ", ")}`
          : sql``;

      subquery.append(sql` COALESCE(json_agg(${data}${order}), '[]'::json)`);
    } else {
      subquery.append(sql` ${data}`);
    }

    subquery.append(sql` AS ${sql.identifier("data")} FROM (${union}) AS ${unionAlias}`);

    return sql`LEFT JOIN LATERAL (${subquery}) AS ${alias} ON true`;
  }

  buildSelectQuery(params: SelectParams): SQLQuery {
    return this._buildSelect(params, createAliasAllocator());
  }

  /**
   * Renders one level of a select tree.
   *
   * Every level gets its own `FROM ... AS "__t<n>"` and binds its table to that alias for
   * the clauses that qualify columns. Column nodes resolve their qualifier from the binding
   * in scope, so nothing above this module needs to know an alias exists.
   */
  private _buildSelect(params: SelectParams, alloc: AliasAllocator): SQLQuery {
    const { table, select, distinct, where, order, limit, offset, join } = params;

    const tableAlias = alloc.table();
    const scope: ReadonlyMap<unknown, string> = new Map([[table, tableAlias]]);
    const scoped = (node: SQLNode) => new SQLScope(scope, node);

    const query = sql`SELECT`;

    if (distinct) {
      query.append(sql` DISTINCT`);
    }

    const selection = this._getSelection(select.map(scoped), join?.map(({ alias }) => alias) ?? []);

    // `table` renders as a source here — schema-qualified, never aliased — and the alias is
    // introduced alongside it.
    query.append(sql` ${selection} FROM ${table} AS ${sql.identifier(tableAlias)}`);

    if (join) {
      for (const joinEntry of join) {
        query.append(sql` ${this._buildLateralJoin(joinEntry, scope, alloc)}`);
      }
    }

    if (where) {
      query.append(sql` WHERE ${scoped(where)}`);
    }

    if (order && order.length > 0) {
      query.append(sql` ORDER BY ${scoped(sql.join(order, ", "))}`);
    }

    if (limit !== undefined) {
      query.append(sql` LIMIT ${sql.param(limit)}`);
    }

    if (offset !== undefined) {
      query.append(sql` OFFSET ${sql.param(offset)}`);
    }

    return query;
  }

  buildInsertQuery(params: InsertParams): SQLQuery {
    const { table, columns, values, return: returning } = params;

    const query = sql`INSERT INTO ${table} (${sql.join(columns, ", ")})`;

    const rows = values.map((row) => sql.wrap(sql.join(row, ", ")));
    query.append(sql` VALUES ${sql.join(rows, ", ")}`);

    if (returning) {
      query.append(sql` RETURNING ${sql.join(returning, ", ")}`);
    }

    return query;
  }

  buildUpdateQuery(params: UpdateParams) {
    const { table, set, where, return: returning } = params;

    const query = sql`UPDATE ${table}`;

    const sets = set.map(([col, val]) => sql`${col} = ${val}`);
    query.append(sql` SET ${sql.join(sets, ", ")}`);

    if (where) {
      query.append(sql` WHERE ${where}`);
    }

    if (returning) {
      query.append(sql` RETURNING ${sql.join(returning, ", ")}`);
    }

    return query;
  }

  buildDeleteQuery(params: DeleteParams) {
    const { table, where, return: returning } = params;

    const query = sql`DELETE FROM ${table}`;

    if (where) {
      query.append(sql` WHERE ${where}`);
    }

    if (returning) {
      query.append(sql` RETURNING ${sql.join(returning, ", ")}`);
    }

    return query;
  }
}
