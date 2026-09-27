import {
  type SQLNode,
  SQLRaw,
  SQLQuery,
  SQLParam,
  isSQLNode,
  SQLIdentifier,
  SQLWrapper,
  SQLValue,
} from "./nodes.js";

export const asNode = (value: SQLValue): SQLNode => {
  if (isSQLNode(value)) {
    return value;
  } else {
    return new SQLParam(value);
  }
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

sql.between = (node: SQLNode, lower: SQLValue, upper: SQLValue) => {
  return sql.join([node, sql.raw("BETWEEN"), asNode(lower), sql.raw("AND"), asNode(upper)]);
};

sql.in = (name: string | SQLNode, values: SQLValue[]) => {
  const identifier = typeof name === "string" ? new SQLIdentifier(name) : name;
  return sql`${identifier} IN ${sql.wrap(sql.join(values.map(asNode), ", "))}`;
};

sql.notIn = (name: string | SQLNode, values: SQLValue[]) => {
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

/** One order key of a keyset: the expression it sorts by and which way. */
export interface KeysetKey {
  node: SQLNode;
  direction: "asc" | "desc";
  /** Whether the key can hold `NULL`. Nullable keys are not supported yet. */
  nullable?: boolean;
}

/** Which side of the cursor row a page reads: rows sorting after it, or before it. */
export type KeysetBound = "after" | "before";

/**
 * The predicate selecting every row that sorts strictly after (or before) a cursor row, under
 * the total order `keys`.
 *
 * Expanded key by key — `k0 > $a OR (k0 = $a AND (k1 > $b OR ...))` — rather than written as a
 * row-value comparison, so mixed directions need no special case and nothing depends on DSQL
 * supporting `(a, b) > ($1, $2)`.
 *
 * `values` are the database's own text for each key, bound as bare parameters: the server
 * parses them against the column's type, so no codec may touch them. A codec that decodes to a
 * JS value can lose precision (a `Date` has milliseconds, a `timestamptz` microseconds), and a
 * cursor rebuilt from the lossy value skips rows.
 */
sql.keyset = (keys: KeysetKey[], values: string[], bound: KeysetBound): SQLNode => {
  if (keys.length === 0) {
    throw new Error("A keyset needs at least one order key.");
  }

  if (keys.length !== values.length) {
    throw new Error(
      `A keyset pairs every key with one value (got ${keys.length} keys, ${values.length} values).`
    );
  }

  for (const [index, key] of keys.entries()) {
    if (key.nullable) {
      throw new Error(`Keyset key ${index} is nullable; nullable order keys are not supported.`);
    }

    if (values[index] === null || values[index] === undefined) {
      throw new Error(`Keyset value ${index} is null; nullable order keys are not supported.`);
    }
  }

  const past = (index: number) => {
    const { node, direction } = keys[index];
    const ascending = direction === "asc";

    return ascending === (bound === "after")
      ? sql.gt(node, values[index])
      : sql.lt(node, values[index]);
  };

  // Built from the last key outwards, so each level wraps the one after it. The last key is a
  // single comparison; every level above it is an `OR`, which needs parentheses to keep its
  // precedence inside the surrounding `AND`.
  let predicate: SQLNode = past(keys.length - 1);

  for (let index = keys.length - 2; index >= 0; index--) {
    const inner = index === keys.length - 2 ? predicate : sql.wrap(predicate);
    const tie = sql.and([sql.eq(keys[index].node, values[index]), inner]);

    predicate = sql.or([past(index), sql.wrap(tie)]);
  }

  return predicate;
};

export { sql };
