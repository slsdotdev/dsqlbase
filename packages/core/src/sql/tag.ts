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
import { escapeValue } from "./utils.js";

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

/** One order key of a keyset: the expression it sorts by and which way. */
export type KeysetKey = {
  node: SQLNode;
  direction: "asc" | "desc";
  /**
   * Whether the key can hold `NULL`. A nullable key sorts its nulls where Postgres does by
   * default — last ascending, first descending — and the order it is read under must say so
   * explicitly (`ASC NULLS LAST`, `DESC NULLS FIRST`) for the predicate to agree with it.
   */
  nullable?: boolean;
};

/** Which side of the cursor row a page reads: rows sorting after it, or before it. */
export type KeysetBound = "after" | "before";

/**
 * The predicate selecting every row that sorts strictly after (or before) a cursor row, under
 * the total order `keys`.
 *
 * Expanded key by key — `k0 > $a OR (k0 = $a AND (k1 > $b OR ...))` — rather than written as a
 * row-value comparison, so mixed directions and nullable keys need no special case and nothing
 * depends on DSQL supporting `(a, b) > ($1, $2)`.
 *
 * `values` are the database's own text for each key, bound as bare parameters: the server
 * parses them against the column's type, so no codec may touch them. A codec that decodes to a
 * JS value can lose precision (a `Date` has milliseconds, a `timestamptz` microseconds), and a
 * cursor rebuilt from the lossy value skips rows. A `null` value is only valid for a nullable key.
 *
 * Per key, in the direction of travel (`before` reads every direction flipped, and flipping an
 * order also flips where its nulls sort, so the table holds for both bounds):
 *
 * | travelling | cursor value | strictly past it           | tied with it  |
 * | ---------- | ------------ | -------------------------- | ------------- |
 * | ascending  | `v`          | `k > v`, or `k IS NULL`\*  | `k = v`       |
 * | ascending  | `NULL`       | nothing (nulls are last)   | `k IS NULL`   |
 * | descending | `v`          | `k < v`                    | `k = v`       |
 * | descending | `NULL`       | `k IS NOT NULL`\*          | `k IS NULL`   |
 *
 * \* nullable keys only.
 */
sql.keyset = (keys: KeysetKey[], values: (string | null)[], bound: KeysetBound): SQLNode => {
  if (keys.length === 0) {
    throw new Error("A keyset needs at least one order key.");
  }

  if (keys.length !== values.length) {
    throw new Error(
      `A keyset pairs every key with one value (got ${keys.length} keys, ${values.length} values).`
    );
  }

  for (const [index, key] of keys.entries()) {
    if (!key.nullable && (values[index] === null || values[index] === undefined)) {
      throw new Error(`Keyset value ${index} is null, but its key is not nullable.`);
    }
  }

  /** The conditions a row satisfies when it sorts strictly past the cursor on key `index`. */
  const past = (index: number): SQLNode[] => {
    const { node, direction, nullable } = keys[index];
    const value = values[index];
    const ascending = (direction === "asc") === (bound === "after");

    if (value === null) {
      return ascending ? [] : [sql.isNotNull(node)];
    }

    if (!ascending) {
      return [sql.lt(node, value)];
    }

    return nullable ? [sql.gt(node, value), sql.isNull(node)] : [sql.gt(node, value)];
  };

  const tie = (index: number) =>
    values[index] === null ? sql.isNull(keys[index].node) : sql.eq(keys[index].node, values[index]);

  // Built from the last key outwards, so each level wraps the one after it. `inner` is the
  // predicate for the keys after this one; `undefined` means no row can satisfy it.
  let inner: SQLNode | undefined;
  let innerIsOr = false;

  for (let index = keys.length - 1; index >= 0; index--) {
    const terms = past(index);

    if (inner) {
      // An `OR` below needs parentheses to keep its precedence inside this `AND`.
      const tied = sql.and([tie(index), innerIsOr ? sql.wrap(inner) : inner]);

      // Alone, the tie needs none: it is an `AND` joining whatever `AND` sits above it.
      terms.push(terms.length > 0 ? sql.wrap(tied) : tied);
    }

    inner = terms.length === 0 ? undefined : terms.length === 1 ? terms[0] : sql.or(terms);
    innerIsOr = terms.length > 1;
  }

  // Nothing can sort past the cursor — only possible when the last key is a nullable one read
  // ascending from a null. A primary key, which every page ends on, is never nullable.
  return inner ?? sql.raw("FALSE");
};

export { sql };
