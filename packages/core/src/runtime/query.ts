import { sql, SQLNode, SQLQuery } from "../sql/index.js";
import { SQLScope } from "../sql/nodes.js";

export interface JoinParams {
  alias: string;
  type: "one" | "many";
  /** Columns on the parent level. Paired positionally with {@link JoinParams.to}. */
  from: SQLNode[];
  /** Columns on the joined level. Paired positionally with {@link JoinParams.from}. */
  to: SQLNode[];
  params: SelectParams;
}

/**
 * Hands out the table and JSON-wrapper aliases for one query build. Kept per build rather
 * than on the builder so `QueryBuilder` stays stateless and safe to share across a client.
 */
interface AliasAllocator {
  table(): string;
  json(): string;
}

const createAliasAllocator = (): AliasAllocator => {
  let tables = 0;
  let wrappers = 0;

  return {
    table: () => `__t${tables++}`,
    json: () => `__j${wrappers++}`,
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
  private _buildCorrelation(join: JoinParams, parentScope: ReadonlyMap<unknown, string>): SQLNode {
    if (join.from.length === 0 || join.from.length !== join.to.length) {
      throw new Error(
        `Join "${join.alias}" must correlate an equal, non-zero number of columns ` +
          `(got ${join.from.length} from, ${join.to.length} to)`
      );
    }

    const pairs = join.to.map((to, index) => sql.eq(to, new SQLScope(parentScope, join.from[index])));

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
    const alias = sql.identifier(`__join_${join.alias}`);
    const innerAlias = sql.identifier(alloc.json());

    const correlation = this._buildCorrelation(join, parentScope);
    const where = join.params.where
      ? sql.and([correlation, sql.wrap(join.params.where)])
      : correlation;

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
