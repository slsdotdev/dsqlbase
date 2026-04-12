import { SQLNode, SQLQuery } from "../sql/nodes.js";
import { sql } from "../sql/tag.js";
import { AnyTable } from "./table.js";

export interface SelectParams {
  table: AnyTable;
  select: SQLNode[];
  where?: SQLNode;
  order?: SQLNode[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
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
  private _getSelection(columns: SQLNode[]): SQLNode {
    if (columns.length === 0) {
      return sql`*`;
    } else {
      return sql.join(columns, ", ");
    }
  }

  buildSelectQuery(params: SelectParams): SQLQuery {
    const { table, select, distinct, where, order, limit, offset } = params;

    const query = sql`SELECT`;

    if (distinct) {
      query.append(sql` DISTINCT`);
    }

    const selection = this._getSelection(select);
    query.append(sql` ${selection} FROM ${table}`);

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
