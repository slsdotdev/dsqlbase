import { SQLNode, SQLQuery } from "../sql/nodes.js";
import { sql } from "../sql/tag.js";
import { AnyTable } from "./table.js";

interface SelectParams {
  table: AnyTable;
  select: SQLNode[];
  where?: SQLNode;
  order?: SQLNode[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
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
}
