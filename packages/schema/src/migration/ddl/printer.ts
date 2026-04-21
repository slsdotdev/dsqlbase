import { sql, SQLContext, SQLNode, SQLQuery } from "@dsqlbase/core";
import { AnyDDLStatement, DDLKind, DDLStatement, isStatement } from "./ast.js";

export type PrintedNode<T extends DDLStatement> = {
  [K in keyof T]: T[K] extends infer S | undefined
    ? S extends (infer N)[]
      ? N extends DDLStatement
        ? SQLNode[] | undefined
        : S
      : S extends DDLStatement
        ? SQLNode | undefined
        : S
    : T[K] extends (infer N)[]
      ? N extends DDLStatement
        ? SQLNode[]
        : T[K] extends DDLStatement
          ? SQLNode
          : T[K]
      : T[K];
};

export interface PrintContext {
  parent?: DDLStatement;
  siblings?: DDLStatement[];
  index?: number;
  indentLevel?: number;
}

type Resolver<T extends DDLStatement> = (
  statement: PrintedNode<T>,
  context: PrintContext
) => SQLNode;

type Reducer = {
  [K in DDLKind]: Extract<AnyDDLStatement, { __kind: K }> extends infer S
    ? S extends DDLStatement
      ? Resolver<S>
      : null
    : never;
};

const identifierList = (names: string[]): SQLNode =>
  sql.join(
    names.map((name) => sql.identifier(name)),
    sql.raw(", ")
  );

const printReducer = {
  CREATE_TABLE: (node) => {
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    const items: SQLNode[] = [...(node.columns ?? []), ...(node.constraints ?? [])];
    const body = sql.join(items, sql.raw(",\n  "));

    return sql`CREATE TABLE ${ifNotExists}${sql.identifier(node.name)} (\n  ${body}\n)`;
  },
  DROP_TABLE: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    return sql`DROP TABLE ${ifExists}${sql.identifier(node.name)}`;
  },
  ALTER_TABLE: (node) => {
    const actions = sql.join(node.actions ?? [], sql.raw(", "));
    return sql`ALTER TABLE ${sql.identifier(node.name)} ${actions}`;
  },
  ADD_COLUMN: (node) => {
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    return sql`ADD COLUMN ${ifNotExists}${node.column}`;
  },
  CREATE_INDEX: (node) => {
    const unique = node.unique ? sql.raw("UNIQUE ") : sql.raw("");
    const async = node.async ? sql.raw("ASYNC ") : sql.raw("");
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    const cols = sql.join(node.columns ?? [], sql.raw(", "));

    const out = sql`CREATE ${unique}INDEX ${async}${ifNotExists}${sql.identifier(node.name)} ON ${sql.identifier(node.tableName)} (${cols})`;

    if (node.include && node.include.length > 0) {
      out.append(sql` INCLUDE (${identifierList(node.include)})`);
    }

    if (node.nullsDistinct === false) {
      out.append(sql.raw(" NULLS NOT DISTINCT"));
    } else if (node.nullsDistinct === true) {
      out.append(sql.raw(" NULLS DISTINCT"));
    }

    return out;
  },
  DROP_INDEX: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    return sql`DROP INDEX ${ifExists}${sql.identifier(node.name)}`;
  },
  INDEX_COLUMN: (node) => {
    const out = new SQLQuery(sql.identifier(node.columnName));
    if (node.sortDirection) out.append(sql.raw(` ${node.sortDirection}`));
    if (node.nulls) out.append(sql.raw(` NULLS ${node.nulls}`));
    return out;
  },
  COLUMN_DEFINITION: (node) => {
    const exp = sql`${sql.identifier(node.name)} ${sql.raw(node.dataType)}`;

    if (node.notNull) exp.append(sql.raw(" NOT NULL"));
    if (node.unique) exp.append(sql.raw(" UNIQUE"));
    if (node.isPrimaryKey) exp.append(sql.raw(" PRIMARY KEY"));
    if (node.defaultValue !== null) exp.append(sql` DEFAULT ${sql.raw(node.defaultValue)}`);
    if (node.check) exp.append(sql` ${node.check}`);

    return exp;
  },
  CHECK_CONSTRAINT: (node) => {
    return sql`CONSTRAINT ${sql.identifier(node.name)} CHECK (${sql.raw(node.expression)})`;
  },
  PRIMARY_KEY_CONSTRAINT: (node) => {
    const cols = identifierList(node.columns ?? []);
    const out = node.name
      ? sql`CONSTRAINT ${sql.identifier(node.name)} PRIMARY KEY (${cols})`
      : sql`PRIMARY KEY (${cols})`;

    if (node.include && node.include.length > 0) {
      out.append(sql` INCLUDE (${identifierList(node.include)})`);
    }

    return out;
  },
  UNIQUE_CONSTRAINT: (node) => {
    const cols = identifierList(node.columns ?? []);
    const out = node.name ? sql`CONSTRAINT ${sql.identifier(node.name)} UNIQUE` : sql`UNIQUE`;

    if (node.nullsDistinct === false) out.append(sql.raw(" NULLS NOT DISTINCT"));
    else if (node.nullsDistinct === true) out.append(sql.raw(" NULLS DISTINCT"));

    out.append(sql` (${cols})`);

    if (node.include && node.include.length > 0) {
      out.append(sql` INCLUDE (${identifierList(node.include)})`);
    }

    return out;
  },
} satisfies Partial<Reducer>;

export function printDDL<T extends DDLStatement>(
  statement: T,
  reducer: Partial<Reducer> = printReducer,
  context?: PrintContext
): SQLNode {
  const resolver = reducer[statement.__kind] as Resolver<T> | undefined;

  if (!resolver) {
    return sql``;
  }

  const ctx: PrintContext = context ?? {};
  const resolved = { ...statement } as PrintedNode<T>;

  for (const [key, value] of Object.entries(statement)) {
    if (isStatement(value)) {
      if (Array.isArray(value)) {
        Object.assign(resolved, {
          [key]: value.map((child, index) =>
            child
              ? printDDL(child, reducer, {
                  parent: statement,
                  siblings: value,
                  index,
                })
              : ""
          ),
        });

        continue;
      }

      Object.assign(resolved, {
        [key]: printDDL(value, reducer, {
          parent: statement,
        }),
      });
    }
  }

  return resolver(resolved, ctx);
}

export function createPrinter(reducer?: Partial<Reducer>, context?: Partial<SQLContext>) {
  return function print(statement: AnyDDLStatement): string {
    const query = sql``.append(printDDL(statement, reducer));
    return query.toQuery(context).text;
  };
}
