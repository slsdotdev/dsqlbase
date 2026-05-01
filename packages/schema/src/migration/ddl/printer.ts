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

const qualifiedName = (schema: string | undefined, name: string): SQLNode =>
  schema ? sql`${sql.identifier(schema)}.${sql.identifier(name)}` : sql.identifier(name);

const printReducer = {
  CREATE_TABLE: (node) => {
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    const items: SQLNode[] = [...(node.columns ?? []), ...(node.constraints ?? [])];
    const body = sql.join(items, sql.raw(",\n  "));

    return sql`CREATE TABLE ${ifNotExists}${qualifiedName(node.schema, node.name)} (\n  ${body}\n)`;
  },
  DROP_TABLE: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    const out = sql`DROP TABLE ${ifExists}${qualifiedName(node.schema, node.name)}`;
    if (node.cascade) out.append(sql.raw(` ${node.cascade}`));
    return out;
  },
  ALTER_TABLE: (node) => {
    const actions = sql.join(node.actions ?? [], sql.raw(", "));
    return sql`ALTER TABLE ${qualifiedName(node.schema, node.name)} ${actions}`;
  },
  ADD_COLUMN: (node) => {
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    return sql`ADD COLUMN ${ifNotExists}${node.column}`;
  },
  RENAME: (node) => sql`RENAME TO ${sql.identifier(node.newName)}`,
  RENAME_COLUMN: (node) =>
    sql`RENAME COLUMN ${sql.identifier(node.columnName)} TO ${sql.identifier(node.newName)}`,
  RENAME_CONSTRAINT: (node) =>
    sql`RENAME CONSTRAINT ${sql.identifier(node.constraintName)} TO ${sql.identifier(node.newName)}`,
  SET_SCHEMA: (node) => sql`SET SCHEMA ${sql.identifier(node.schemaName)}`,
  OWNER: (node) => sql`OWNER TO ${sql.identifier(node.roleName)}`,
  CREATE_INDEX: (node) => {
    const unique = node.unique ? sql.raw("UNIQUE ") : sql.raw("");
    const async = node.async ? sql.raw("ASYNC ") : sql.raw("");
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    const cols = sql.join(node.columns ?? [], sql.raw(", "));

    const out = sql`CREATE ${unique}INDEX ${async}${ifNotExists}${sql.identifier(node.name)} ON ${qualifiedName(node.tableSchema, node.tableName)} (${cols})`;

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
    const out = sql`DROP INDEX ${ifExists}${qualifiedName(node.schema, node.name)}`;
    if (node.cascade) out.append(sql.raw(` ${node.cascade}`));
    return out;
  },
  ALTER_INDEX: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    return sql`ALTER INDEX ${ifExists}${qualifiedName(node.schema, node.name)} ${node.action}`;
  },
  CREATE_SCHEMA: (node) => {
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    return sql`CREATE SCHEMA ${ifNotExists}${sql.identifier(node.name)}`;
  },
  DROP_SCHEMA: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    const out = sql`DROP SCHEMA ${ifExists}${sql.identifier(node.name)}`;
    if (node.cascade) out.append(sql.raw(` ${node.cascade}`));
    return out;
  },
  SEQUENCE_OPTIONS: (node) => {
    const parts: SQLNode[] = [];
    if (node.dataType !== undefined) parts.push(sql`AS ${sql.raw(node.dataType)}`);
    if (node.incrementBy !== undefined) parts.push(sql.raw(`INCREMENT BY ${node.incrementBy}`));
    if (node.minValue !== undefined) parts.push(sql.raw(`MINVALUE ${node.minValue}`));
    if (node.maxValue !== undefined) parts.push(sql.raw(`MAXVALUE ${node.maxValue}`));
    if (node.startValue !== undefined) parts.push(sql.raw(`START WITH ${node.startValue}`));
    if (node.cache !== undefined) parts.push(sql.raw(`CACHE ${node.cache}`));
    if (node.cycle === true) parts.push(sql.raw("CYCLE"));
    else if (node.cycle === false) parts.push(sql.raw("NO CYCLE"));
    if (node.ownedBy !== undefined) parts.push(sql`OWNED BY ${sql.raw(node.ownedBy)}`);
    return sql.join(parts, sql.raw(" "));
  },
  CREATE_SEQUENCE: (node) => {
    const ifNotExists = node.ifNotExists ? sql.raw("IF NOT EXISTS ") : sql.raw("");
    const out = sql`CREATE SEQUENCE ${ifNotExists}${qualifiedName(node.schema, node.name)}`;
    if (node.options) out.append(sql` ${node.options}`);
    return out;
  },
  DROP_SEQUENCE: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    const out = sql`DROP SEQUENCE ${ifExists}${qualifiedName(node.schema, node.name)}`;
    if (node.cascade) out.append(sql.raw(` ${node.cascade}`));
    return out;
  },
  ALTER_SEQUENCE: (node) => {
    const out = sql`ALTER SEQUENCE ${qualifiedName(node.schema, node.name)}`;
    if (node.options) out.append(sql` ${node.options}`);
    if (node.restart) {
      out.append(
        node.restart.with !== undefined
          ? sql.raw(` RESTART WITH ${node.restart.with}`)
          : sql.raw(" RESTART")
      );
    }
    return out;
  },
  CREATE_DOMAIN: (node) => {
    const out = sql`CREATE DOMAIN ${qualifiedName(node.schema, node.name)} AS ${sql.raw(node.dataType)}`;
    if (node.notNull) out.append(sql.raw(" NOT NULL"));
    if (node.defaultValue !== undefined) out.append(sql` DEFAULT ${sql.raw(node.defaultValue)}`);
    if (node.check) out.append(sql` ${node.check}`);
    return out;
  },
  DROP_DOMAIN: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    const out = sql`DROP DOMAIN ${ifExists}${qualifiedName(node.schema, node.name)}`;
    if (node.cascade) out.append(sql.raw(` ${node.cascade}`));
    return out;
  },
  IDENTITY_CONSTRAINT: (node) => {
    const mode = node.mode === "ALWAYS" ? "ALWAYS" : "BY DEFAULT";
    const out = sql`${sql.raw(`GENERATED ${mode} AS IDENTITY`)}`;
    if (node.options) out.append(sql` (${node.options})`);
    return out;
  },
  GENERATED_EXPRESSION: (node) => {
    return sql`GENERATED ALWAYS AS (${sql.raw(node.expression)}) STORED`;
  },
  INDEX_COLUMN: (node) => {
    const out = new SQLQuery(sql.identifier(node.columnName));
    if (node.sortDirection) out.append(sql.raw(` ${node.sortDirection}`));
    if (node.nulls) out.append(sql.raw(` NULLS ${node.nulls}`));
    return out;
  },
  COLUMN_DEFINITION: (node) => {
    const exp = sql`${sql.identifier(node.name)} ${sql.raw(node.dataType)}`;

    if (node.identity) exp.append(sql` ${node.identity}`);
    if (node.generated) exp.append(sql` ${node.generated}`);
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
  SET_NOT_NULL: () => sql.raw("SET NOT NULL"),
  DROP_NOT_NULL: () => sql.raw("DROP NOT NULL"),
  SET_DEFAULT: (node) => sql`SET DEFAULT ${sql.raw(node.expression)}`,
  DROP_DEFAULT: () => sql.raw("DROP DEFAULT"),
  SET_DATA_TYPE: (node) => {
    const out = sql`SET DATA TYPE ${sql.raw(node.dataType)}`;
    if (node.using !== undefined) out.append(sql` USING ${sql.raw(node.using)}`);
    return out;
  },
  SET_GENERATED: (node) => {
    const mode = node.mode === "ALWAYS" ? "ALWAYS" : "BY DEFAULT";
    const out = sql`${sql.raw(`SET GENERATED ${mode}`)}`;
    if (node.options) out.append(sql` ${node.options}`);
    return out;
  },
  RESTART: (node) =>
    node.with !== undefined ? sql.raw(`RESTART WITH ${node.with}`) : sql.raw("RESTART"),
  DROP_IDENTITY: (node) =>
    node.ifExists ? sql.raw("DROP IDENTITY IF EXISTS") : sql.raw("DROP IDENTITY"),
  ADD_CONSTRAINT: (node) => sql`ADD ${node.constraint}`,
  DROP_CONSTRAINT: (node) => {
    const ifExists = node.ifExists ? sql.raw("IF EXISTS ") : sql.raw("");
    const out = sql`DROP CONSTRAINT ${ifExists}${sql.identifier(node.name)}`;
    if (node.cascade) out.append(sql.raw(` ${node.cascade}`));
    return out;
  },
  VALIDATE_CONSTRAINT: (node) => sql`VALIDATE CONSTRAINT ${sql.identifier(node.name)}`,
  ALTER_COLUMN: (node) => {
    const parts = (node.actions ?? []).map(
      (action) => sql`ALTER COLUMN ${sql.identifier(node.columnName)} ${action}`
    );
    return sql.join(parts, sql.raw(", "));
  },
  ALTER_DOMAIN: (node) => sql`ALTER DOMAIN ${qualifiedName(node.schema, node.name)} ${node.action}`,
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

export function createPrinter(context?: Partial<SQLContext>, reducer?: Partial<Reducer>) {
  return function print(statement: DDLStatement): string {
    const query = sql`${printDDL(statement, reducer)}`;
    return query.toQuery(context).text;
  };
}
