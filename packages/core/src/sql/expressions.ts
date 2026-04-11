import { isSQLNode, SQLNode, SQLParam } from "./nodes.js";
import { sql } from "./tag.js";

export const asNode = (value: unknown): SQLNode => {
  if (isSQLNode(value)) {
    return value;
  } else {
    return new SQLParam(value);
  }
};

export const equals = (left: SQLNode, right: unknown): SQLNode => {
  return sql.join([left, sql.raw("="), asNode(right)]);
};

export const notEquals = (left: SQLNode, right: unknown): SQLNode => {
  return sql.join([left, sql.raw("<>"), asNode(right)]);
};

export const greaterThan = (left: SQLNode, right: unknown): SQLNode => {
  return sql.join([left, sql.raw(">"), asNode(right)]);
};

export const lessThan = (left: SQLNode, right: unknown): SQLNode => {
  return sql.join([left, sql.raw("<"), asNode(right)]);
};

export const greaterThanOrEquals = (left: SQLNode, right: unknown): SQLNode => {
  return sql.join([left, sql.raw(">="), asNode(right)]);
};

export const lessThanOrEquals = (left: SQLNode, right: unknown): SQLNode => {
  return sql.join([left, sql.raw("<="), asNode(right)]);
};

export const and = (conditions: SQLNode[]): SQLNode => {
  return sql.join(conditions, sql.raw(" AND "));
};

export const or = (conditions: SQLNode[]): SQLNode => {
  return sql.join(conditions, sql.raw(" OR "));
};

export const not = (condition: SQLNode): SQLNode => {
  return sql.join([sql.raw("NOT"), sql.wrap(condition)]);
};

export const isNull = (node: SQLNode): SQLNode => {
  return sql.join([node, sql.raw("IS NULL")]);
};

export const isNotNull = (node: SQLNode): SQLNode => {
  return sql.join([node, sql.raw("IS NOT NULL")]);
};

export const like = (node: SQLNode, pattern: unknown): SQLNode => {
  return sql.join([node, sql.raw("LIKE"), asNode(pattern)]);
};

export const notLike = (node: SQLNode, pattern: unknown): SQLNode => {
  return sql.join([node, sql.raw("NOT LIKE"), asNode(pattern)]);
};

export const iLike = (node: SQLNode, pattern: unknown): SQLNode => {
  return sql.join([node, sql.raw("ILIKE"), asNode(pattern)]);
};

export const notILike = (node: SQLNode, pattern: unknown): SQLNode => {
  return sql.join([node, sql.raw("NOT ILIKE"), asNode(pattern)]);
};

export const between = (node: SQLNode, lower: unknown, upper: unknown): SQLNode => {
  return sql.join([node, sql.raw("BETWEEN"), asNode(lower), sql.raw("AND"), asNode(upper)]);
};

export const inList = (node: SQLNode, values: unknown[]): SQLNode => {
  const valueNodes = values.map(asNode);
  return sql.join([node, sql.raw("IN"), sql.join(valueNodes, sql.raw(", "))]);
};

export const notInList = (node: SQLNode, values: unknown[]): SQLNode => {
  const valueNodes = values.map(asNode);
  return sql.join([node, sql.raw("NOT IN"), sql.join(valueNodes, sql.raw(", "))]);
};

export const inQuery = (node: SQLNode, subquery: SQLNode): SQLNode => {
  return sql.join([node, sql.raw("IN"), sql.wrap(subquery)]);
};

export const notInQuery = (node: SQLNode, subquery: SQLNode): SQLNode => {
  return sql.join([node, sql.raw("NOT IN"), sql.wrap(subquery)]);
};

export const exists = (subquery: SQLNode): SQLNode => {
  return sql.join([sql.raw("EXISTS"), sql.wrap(subquery)]);
};

export const notExists = (subquery: SQLNode): SQLNode => {
  return sql.join([sql.raw("NOT EXISTS"), sql.wrap(subquery)]);
};
