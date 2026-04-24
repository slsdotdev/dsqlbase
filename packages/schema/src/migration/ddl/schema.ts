import { SQLContext } from "@dsqlbase/core";
import {
  AnyDomainDefinition,
  AnyNamespaceDefinition,
  AnySequenceDefinition,
  AnyTableDefinition,
} from "@dsqlbase/core/definition";
import { SerializedObject, SerializedSchema, sortSchemaObjects } from "../base.js";
import { DDLStatement } from "./ast.js";
import { ddl } from "./factory.js";
import { createPrinter } from "./printer.js";

/**
 * A marker string used to indicate a breakpoint between DDL statements in the generated SQL. This can be useful for debugging or for tools that need to split the generated SQL into individual statements.
 */
export const STATEMENT_BREAKPOINT = `-- statement breakpoint`;

export function createTableDDL<T extends SerializedObject<AnyTableDefinition>>(
  table: T,
  ifNotExists = true
) {
  const columns = table.columns.map((col) =>
    ddl.column({
      name: col.name,
      dataType: col.dataType,
      isPrimaryKey: col.primaryKey,
      notNull: col.notNull,
      defaultValue: col.defaultValue,
      unique: col.unique,
      check: col.check
        ? ddl.check({ name: col.check.name, expression: col.check.expression })
        : undefined,
    })
  );

  const constrainds = table.constraints.map((constraint) => {
    if (constraint.kind === "CHECK_CONSTRAINT") {
      return ddl.check({
        name: constraint.name,
        expression: constraint.expression,
      });
    }

    if (constraint.kind === "PRIMARY_KEY_CONSTRAINT") {
      return ddl.primaryKey({
        name: constraint.name,
        columns: constraint.columns,
        include: constraint.include,
      });
    }

    if (constraint.kind === "UNIQUE_CONSTRAINT") {
      return ddl.unique({
        name: constraint.name,
        columns: constraint.columns,
        include: constraint.include ?? undefined,
        nullsDistinct: constraint.distinctNulls,
      });
    }

    throw new Error(
      `Unreachable code: unknown constraint kind ${constraint["kind" as keyof typeof constraint]}`
    );
  });

  return ddl.createTable({
    name: table.name,
    ifNotExists,
    columns,
    constraints: constrainds,
  });
}

export function createIndexDDL(
  index: SerializedObject<AnyTableDefinition>["indexes"][number],
  tableName: string,
  ifNotExists = true,
  async = false
) {
  const indexColumns = index.columns.map((col) =>
    ddl.indexColumn({
      columnName: col.column,
      sortDirection: col.sortDirection,
      nulls: col.nulls,
    })
  );

  return ddl.createIndex({
    name: index.name,
    tableName,
    unique: index.unique,
    columns: indexColumns,
    include: index.include ?? undefined,
    nullsDistinct: index.distinctNulls,
    ifNotExists,
    async: async ? true : undefined,
  });
}

export function createSchemaDDL(
  schema: SerializedObject<AnyNamespaceDefinition>,
  ifNotExists = true
) {
  return ddl.createSchema({
    name: schema.name,
    ifNotExists,
  });
}

export function createDomainDDL(definition: SerializedObject<AnyDomainDefinition>) {
  return ddl.createDomain({
    name: definition.name,
    dataType: definition.dataType,
    notNull: definition.notNull,
    defaultValue: definition.defaultValue,
    check: definition.check
      ? ddl.check({ name: definition.check.name, expression: definition.check.expression })
      : undefined,
  });
}

export function createSequenceDDL(
  definition: SerializedObject<AnySequenceDefinition>,
  ifNotExists = true
) {
  return ddl.createSequence({
    name: definition.name,
    ifNotExists,
    options: ddl.sequenceOptions({
      incrementBy: definition.increment,
      minValue: definition.minValue,
      maxValue: definition.maxValue,
      startValue: definition.startValue,
      cache: definition.cache,
      cycle: definition.cycle,
    }),
  });
}

export interface PrintSchemaOptions {
  /**
   * Whether to include `IF NOT EXISTS` clauses in the generated SQL. Defaults to `true`.
   * @default true
   */
  ifNotExists?: boolean;

  /**
   * Whether to generate indexes as `CREATE INDEX ASYNC` (DSQL dialect)
   * @default false
   */
  asyncIndexes?: boolean;

  /**
   * Optional SQL context to use when printing the SQL. This can be used to provide additional information or configuration for the SQL generation process, such as quoting identifiers or formatting options.
   */
  sqlContext?: Partial<SQLContext>;
}

/**
 * Generates full DDL SQL for creating the given schema, including all tables, domains, namespaces, sequences, and views.
 */
export function printSchemaForCreate<T extends SerializedSchema>(
  schema: T,
  options: PrintSchemaOptions = {}
) {
  const {
    ifNotExists = true,
    asyncIndexes = false,
    sqlContext = { inlineParams: true },
  } = options ?? {};
  const statements: DDLStatement[] = [];
  const sorted = sortSchemaObjects(schema);
  const printer = createPrinter(sqlContext);

  for (const obj of sorted) {
    if (obj.kind === "SCHEMA") {
      const createSchema = createSchemaDDL(obj, ifNotExists);
      statements.push(createSchema);
    }

    if (obj.kind === "DOMAIN") {
      const createDomain = createDomainDDL(obj);
      statements.push(createDomain);
    }

    if (obj.kind === "SEQUENCE") {
      const createSequence = createSequenceDDL(obj, ifNotExists);
      statements.push(createSequence);
    }

    if (obj.kind === "TABLE") {
      const createTable = createTableDDL(obj, ifNotExists);
      statements.push(createTable);

      if (obj.indexes) {
        for (const idx of obj.indexes) {
          const index = createIndexDDL(idx, obj.name, ifNotExists, asyncIndexes);
          statements.push(index);
        }
      }
    }
  }

  return statements.map((stmt) => printer(stmt));
}
