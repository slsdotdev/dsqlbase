import {
  AnyColumnDefinition,
  AnyIndexDefinition,
  AnyTableDefinition,
} from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  ColumnDefinitionExpression,
  IndexColumnExpression,
  TableConstraintExpression,
} from "../../ddl/ast.js";
import { ddl } from "../../ddl/index.js";
import {
  DDLOperation,
  DDLOperationError,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
  qualifiedName,
} from "./base.js";

export function createTableOperation(
  object: SerializedObject<AnyTableDefinition>,
  ifNotExists = true
): DDLOperation {
  const references: string[] = maybeNamespaceReference(object) ?? [];
  const columns: ColumnDefinitionExpression[] = [];
  const constraints: TableConstraintExpression[] = [];

  for (const column of object.columns as SerializedObject<AnyColumnDefinition>[]) {
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

  for (const constraint of object.constraints) {
    if (constraint.kind === "CHECK_CONSTRAINT") {
      constraints.push(
        ddl.check({
          name: constraint.name,
          expression: constraint.expression,
        })
      );
    }

    if (constraint.kind === "PRIMARY_KEY_CONSTRAINT") {
      constraints.push(
        ddl.primaryKey({
          name: constraint.name,
          columns: constraint.columns,
          include: constraint.include,
        })
      );
    }

    if (constraint.kind === "UNIQUE_CONSTRAINT") {
      constraints.push(
        ddl.unique({
          name: constraint.name,
          columns: constraint.columns,
          include: constraint.include ?? undefined,
          nullsDistinct: constraint.distinctNulls,
        })
      );
    }
  }

  const statement = ddl.createTable({
    name: object.name,
    ifNotExists,
    columns,
    constraints,
  });

  return {
    type: "CREATE",
    object: object,
    statement,
    references,
  };
}

export function createIndexOperation(
  index: SerializedObject<AnyIndexDefinition>,
  tableName: string,
  ifNotExists = true,
  async = false
): DDLOperation {
  const references: string[] = maybeNamespaceReference(index) ?? [];
  references.push(tableName);

  const columns: IndexColumnExpression[] = [];

  for (const column of index.columns) {
    columns.push(
      ddl.indexColumn({
        columnName: column.name,
        sortDirection: column.sortDirection,
        nulls: column.nulls,
      })
    );
  }

  const statement = ddl.createIndex({
    name: index.name,
    tableName,
    unique: index.unique,
    columns,
    include: index.include ?? undefined,
    nullsDistinct: index.distinctNulls,
    ifNotExists,
    async: async ? true : undefined,
  });

  return {
    type: "CREATE",
    object: index,
    statement,
    references,
  };
}

export function dropTableOperation(object: SerializedObject<AnyTableDefinition>): DDLOperation {
  return {
    type: "DROP",
    object: object,
    statement: ddl.dropTable({
      name: object.name,
      ifExists: true,
      cascade: "CASCADE",
    }),
    references: maybeNamespaceReference(object),
  };
}

export function diffTableOperations(
  local: SerializedObject<AnyTableDefinition>,
  remote?: SerializedObject<SchemaObjectType>
): OperationResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];

  if (!remote) {
    const tableName = qualifiedName(local);
    operations.push(createTableOperation(local));

    if (local.indexes.length) {
      for (const idx of local.indexes) {
        operations.push(createIndexOperation(idx, tableName));
      }
    }

    return { operations, errors };
  }

  if (remote.kind !== "TABLE") {
    errors.push(kindMismatchError("TABLE", remote));

    return { operations, errors };
  }

  return { operations, errors };
}
