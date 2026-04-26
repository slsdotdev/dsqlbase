import {
  AnyColumnDefinition,
  AnyDomainDefinition,
  AnyIndexDefinition,
  AnyNamespaceDefinition,
  AnySequenceDefinition,
  AnyTableDefinition,
} from "@dsqlbase/core/definition";
import { SerializedObject } from "../base.js";
import { ddl } from "../ddl/factory.js";
import { ColumnDefinitionExpression } from "../ddl/ast.js";

export function createSchemaStatement(
  schema: SerializedObject<AnyNamespaceDefinition>,
  ifNotExists = true
) {
  return ddl.createSchema({
    name: schema.name,
    ifNotExists,
  });
}

export function createTableStatement<T extends SerializedObject<AnyTableDefinition>>(
  table: T,
  ifNotExists = true,
  references: string[] = []
) {
  const columns: ColumnDefinitionExpression[] = [];

  for (const column of table.columns as SerializedObject<AnyColumnDefinition>[]) {
    if (column.domain) {
      references.push(column.domain);
    }

    columns.push(
      ddl.column({
        name: column.name,
        dataType: column.dataType,
        isPrimaryKey: column.primaryKey,
        notNull: column.notNull,
        defaultValue: column.defaultValue,
        unique: column.unique,
        check: column.check
          ? ddl.check({ name: column.check.name, expression: column.check.expression })
          : undefined,
      })
    );
  }

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

  const statement = ddl.createTable({
    name: table.name,
    ifNotExists,
    columns,
    constraints: constrainds,
  });

  return { statement, references };
}

export function createIndexStatement(
  index: SerializedObject<AnyIndexDefinition>,
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

export function createDomainStatement(
  definition: SerializedObject<AnyDomainDefinition>,
  ifNotExists = true
) {
  return ddl.createDomain({
    name: definition.name,
    schema: definition.namespace,
    dataType: definition.dataType,
    notNull: definition.notNull,
    defaultValue: definition.defaultValue,
    check: definition.check
      ? ddl.check({ name: definition.check.name, expression: definition.check.expression })
      : undefined,
    ifNotExists,
  });
}

export function createSequenceStatement(
  definition: SerializedObject<AnySequenceDefinition>,
  ifNotExists = true
) {
  return ddl.createSequence({
    name: definition.name,
    schema: definition.namespace,
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

export function dropSchemaStatement(
  name: string,
  ifExists = true,
  cascade: "CASCADE" | "RESTRICT" = "CASCADE"
) {
  return ddl.dropSchema({
    name,
    ifExists,
    cascade,
  });
}
