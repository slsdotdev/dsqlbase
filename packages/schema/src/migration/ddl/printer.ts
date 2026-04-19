import { sql, SQLNode } from "@dsqlbase/core";
import { AnyDDLStatement, DDLKind, DDLStatement, isStatement } from "./ast.js";

export type Printed<T extends DDLStatement> = {
  [K in keyof T]: T[K] extends infer S | undefined
    ? S extends (infer N)[]
      ? N extends DDLStatement
        ? SQLNode[] | undefined
        : S
      : S extends DDLStatement
        ? SQLNode
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

type Resolver<T extends DDLStatement> = (statement: Printed<T>, context: PrintContext) => SQLNode;

type Reducer = {
  [K in DDLKind]: Extract<AnyDDLStatement, { __kind: K }> extends infer S
    ? S extends DDLStatement
      ? Resolver<S>
      : null
    : never;
};

const printReducer: Reducer = {
  CREATE_TABLE: (node) => {
    const condition = node.ifNotExists ? sql` IF NOT EXISTS ` : sql` `;
    return sql`CREATE TABLE${condition}${node.name} (${node.columns?.join(",\n")})`;
  },
  COLUMN_DEFINITION: (node) => {
    const exp = sql`${node.name} ${node.dataType}`;

    if (node.notNull) exp.append(sql` NOT NULL`);
    if (node.unique) exp.append(sql` UNIQUE`);
    if (node.isPrimaryKey) exp.append(sql` PRIMARY KEY`);
    if (node.defaultValue !== null) exp.append(sql` DEFAULT ${node.defaultValue}`);
    if (node.check) exp.append(sql` ${node.check}`);

    return exp;
  },
  CHECK_CONSTRAINT: (node) => {
    return sql`CONSTRAINT ${node.name} CHECK (${node.expression})`;
  },
};

export function printDDL<T extends DDLStatement>(
  statement: T,
  reducer: Reducer = printReducer,
  context?: PrintContext
): SQLNode {
  const resolver = reducer[statement.__kind] as Resolver<T>;

  if (!resolver) {
    return sql``;
  }

  const ctx: PrintContext = context ?? {};
  const resolved = { ...statement } as Printed<T>;

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
