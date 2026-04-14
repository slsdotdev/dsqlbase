import { SQLNode, SQLQuery } from "../sql/index.js";

export interface JoinParams {
  alias: string;
  type: "one" | "many";
  from: SQLNode;
  to: SQLNode;
  params: SelectParams;
}

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

export interface QueryBuilder {
  buildSelectQuery(params: SelectParams): SQLQuery;
  buildInsertQuery(params: InsertParams): SQLQuery;
  buildUpdateQuery(params: UpdateParams): SQLQuery;
  buildDeleteQuery(params: DeleteParams): SQLQuery;
}
