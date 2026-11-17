import {
  type SQLNode,
  SQLRaw,
  SQLQuery,
  SQLParam,
  isSQLNode,
  SQLIdentifier,
  SQLWrapper,
  SQLValue,
  SQLClaim,
} from "./nodes.js";
import { escapeValue } from "./utils.js";

export const asNode = (value: SQLValue): SQLNode => {
  if (isSQLNode(value)) {
    return value;
  } else {
    return new SQLParam(value);
  }
};

export const escapeLike = (value: unknown): string => {
  return String(value).replace(/[\\%_]/g, "\\$&");
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sql<T>(strings: TemplateStringsArray, ...params: any[]): SQLQuery<T>;
function sql(strings: TemplateStringsArray, ...params: SQLNode[]): SQLQuery {
  const node = new SQLQuery();

  if (params.length > 0 || (strings.length > 0 && strings[0] !== "")) {
    node.append(new SQLRaw(strings[0]));
  }

  for (const [paramIndex, param] of params.entries()) {
    node.append(isSQLNode(param) ? param : new SQLParam(param));
    node.append(new SQLRaw(strings[paramIndex + 1]));
  }

  return node;
}

sql.raw = (text: string) => new SQLRaw(text);
sql.param = <TValue extends SQLValue>(value: TValue, serialize?: (value: TValue) => TValue) =>
  new SQLParam<TValue>(value, serialize);
sql.identifier = (name: string) => new SQLIdentifier(name);
/**
 * A string written into the statement as a quoted literal rather than bound as a parameter.
 * For values the schema owns — a union member's alias projected as its `$$key` — never for
 * anything a caller passed in: a literal is part of the query text, a parameter is not.
 */
sql.literal = (value: string) => new SQLRaw(escapeValue(value));
sql.wrap = (node: SQLNode) => new SQLWrapper(node);

sql.join = (nodes: SQLNode[], separator: string | SQLNode = " ") => {
  const node = new SQLQuery();

  for (const [index, childNode] of nodes.entries()) {
    if (index > 0) {
      node.append(typeof separator === "string" ? new SQLRaw(separator) : separator);
    }

    node.append(childNode);
  }

  return node;
};

sql.claim = <TValue extends SQLValue>(key: string, serialize?: (value: unknown) => unknown) =>
  new SQLClaim<TValue>(key, serialize);

sql.eq = (left: SQLNode, right: SQLValue) => {
  return sql.join([left, sql.raw("="), asNode(right)]);
};

sql.ne = (left: SQLNode, right: SQLValue) => {
  return sql.join([left, sql.raw("<>"), asNode(right)]);
};

sql.gt = (left: SQLNode, right: SQLValue) => {
  return sql.join([left, sql.raw(">"), asNode(right)]);
};

sql.lt = (left: SQLNode, right: SQLValue) => {
  return sql.join([left, sql.raw("<"), asNode(right)]);
};

sql.gte = (left: SQLNode, right: SQLValue) => {
  return sql.join([left, sql.raw(">="), asNode(right)]);
};

sql.lte = (left: SQLNode, right: SQLValue) => {
  return sql.join([left, sql.raw("<="), asNode(right)]);
};

sql.and = (conditions: SQLNode[]) => {
  return sql.join(conditions, sql.raw(" AND "));
};

sql.or = (conditions: SQLNode[]) => {
  return sql.join(conditions, sql.raw(" OR "));
};

sql.not = (condition: SQLNode) => {
  return sql.join([sql.raw("NOT"), sql.wrap(condition)]);
};

sql.isNull = (node: SQLNode) => {
  return sql.join([node, sql.raw("IS NULL")]);
};

sql.isNotNull = (node: SQLNode) => {
  return sql.join([node, sql.raw("IS NOT NULL")]);
};

sql.like = (node: SQLNode, pattern: SQLValue) => {
  return sql.join([node, sql.raw("LIKE"), asNode(pattern)]);
};

sql.notLike = (node: SQLNode, pattern: SQLValue) => {
  return sql.join([node, sql.raw("NOT LIKE"), asNode(pattern)]);
};

sql.iLike = (node: SQLNode, pattern: SQLValue) => {
  return sql.join([node, sql.raw("ILIKE"), asNode(pattern)]);
};

sql.notILike = (node: SQLNode, pattern: SQLValue) => {
  return sql.join([node, sql.raw("NOT ILIKE"), asNode(pattern)]);
};

/**
 * `jsonb` containment, `node @> value`: the document holds `value`, matched recursively — objects
 * by the keys `value` names, arrays as a subset in any order. `value` is the JSON text of a
 * fragment.
 */
sql.jsonbContains = (node: SQLNode, value: SQLValue) => {
  return sql.join([node, sql.raw("@>"), asNode(value)]);
};

/** `jsonb` key existence, `node ? key`: the object has `key` at its top level. */
sql.jsonbHasKey = (node: SQLNode, key: SQLValue) => {
  return sql.join([node, sql.raw("?"), asNode(key)]);
};

sql.between = (node: SQLNode, lower: SQLValue, upper: SQLValue) => {
  return sql.join([node, sql.raw("BETWEEN"), asNode(lower), sql.raw("AND"), asNode(upper)]);
};

// An empty list has no SQL form — `IN ()` is a syntax error — so it renders as the answer:
// nothing is in an empty list, everything is outside it.
sql.in = (name: string | SQLNode, values: SQLValue[]) => {
  if (values.length === 0) return sql`FALSE`;
  const identifier = typeof name === "string" ? new SQLIdentifier(name) : name;
  return sql`${identifier} IN ${sql.wrap(sql.join(values.map(asNode), ", "))}`;
};

sql.notIn = (name: string | SQLNode, values: SQLValue[]) => {
  if (values.length === 0) return sql`TRUE`;
  const identifier = typeof name === "string" ? new SQLIdentifier(name) : name;
  return sql`${identifier} NOT IN ${sql.wrap(sql.join(values.map(asNode), ", "))}`;
};

sql.inQuery = (name: string | SQLNode, query: SQLQuery) => {
  const identifier = typeof name === "string" ? new SQLIdentifier(name) : name;
  return sql`${identifier} IN ${sql.wrap(query)}`;
};

sql.notInQuery = (name: string | SQLNode, query: SQLQuery) => {
  const identifier = typeof name === "string" ? new SQLIdentifier(name) : name;
  return sql`${identifier} NOT IN ${sql.wrap(query)}`;
};

sql.exists = (query: SQLQuery) => {
  return sql`EXISTS ${sql.wrap(query)}`;
};

sql.notExists = (query: SQLQuery) => {
  return sql`NOT EXISTS ${sql.wrap(query)}`;
};

export { sql };
