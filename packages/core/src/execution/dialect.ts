import { SQLNode, SQLQuery } from "../sql/nodes.js";
import { sql } from "../sql/tag.js";
import { AnyTable } from "./table.js";

export interface JoinParams {
  alias: string;
  type: "one" | "many";
  from: SQLNode;
  to: SQLNode;
  params: SelectParams;
}

export interface SelectParams {
  table: AnyTable;
  select: SQLNode[];
  where?: SQLNode;
  order?: SQLNode[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  join?: JoinParams[];
}

export interface InsertParams {
  table: AnyTable;
  columns: SQLNode[];
  values: SQLNode[][];
  return?: SQLNode[];
}

export interface UpdateParams {
  table: AnyTable;
  set: [column: SQLNode, value: SQLNode][];
  where?: SQLNode;
  return?: SQLNode[];
}

export interface DeleteParams {
  table: AnyTable;
  where?: SQLNode;
  return?: SQLNode[];
}

export class QueryDialect {
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
   * SELECT "id", "title", "description", "__rel_assignee"."data" AS "assignee" FROM "tasks" 
      LEFT JOIN LATERAL (
        SELECT row_to_json("__t".*) AS "data" 
        FROM (
          SELECT "id", "name", "email" 
          FROM "users" 
          WHERE "users"."id" = "tasks"."assignee_id"
        ) AS "__t"
      ) AS "__rel_assignee" 
      ON true
   */
  private _buildLateralJoin(join: JoinParams): SQLNode {
    const alias = sql.identifier(`__join_${join.alias}`);

    const innerAlias = sql.identifier(`__t`);
    const innerQuery = this.buildSelectQuery(join.params);

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
    const { table, select, distinct, where, order, limit, offset, join } = params;

    const query = sql`SELECT`;

    if (distinct) {
      query.append(sql` DISTINCT`);
    }

    const selection = this._getSelection(select, join?.map(({ alias }) => alias) ?? []);
    query.append(sql` ${selection} FROM ${table}`);

    if (join) {
      for (const joinEntry of join) {
        const joinNode = this._buildLateralJoin(joinEntry);
        query.append(sql` ${joinNode}`);
      }
    }

    if (where) {
      query.append(sql` WHERE ${where}`);
    }

    if (order && order.length > 0) {
      query.append(sql` ORDER BY ${sql.join(order, ", ")}`);
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
