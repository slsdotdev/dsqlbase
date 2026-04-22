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

sql.in = (name: string | SQLNode, values: SQLValue[]) => {
  const identifier = typeof name === "string" ? new SQLIdentifier(name) : name;

  return sql`${identifier} IN ${sql.wrap(
    sql.join(
      values.map((value) => sql.param(value)),
      ", "
    )
  )}`;
};

export { sql };
