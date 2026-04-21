import {
  AnyDomainDefinition,
  AnyTableDefinition,
  AnyNamespaceDefinition,
  DefinitionNode,
  NodeKind,
  SequenceDefinition,
  ViewDefinition,
} from "@dsqlbase/core";
import { DDLStatement, TableConstraintExpression } from "./ddl/ast.js";
import { ddl } from "./ddl/factory.js";

export const SCHEMA_OBJECT_ORDER: NodeKind[] = [
  "SCHEMA",
  "DOMAIN",
  "TABLE",
  "SEQUENCE",
  "VIEW",
] as const;

export type SchemaObjectType =
  | AnyNamespaceDefinition
  | AnyDomainDefinition
  | AnyTableDefinition
  | SequenceDefinition<string>
  | ViewDefinition<string>;

export type SerializedObject<T extends SchemaObjectType> = ReturnType<T["toJSON"]>;

export type SerializedSchema<T extends SchemaObjectType[] = SchemaObjectType[]> =
  (T extends (infer U)[] ? (U extends SchemaObjectType ? SerializedObject<U> : never) : never)[];

export function isSchemaObjectKind(node: DefinitionNode): node is SchemaObjectType {
  return SCHEMA_OBJECT_ORDER.includes(node.kind);
}

export function isDefinitionInstance(obj: unknown): obj is DefinitionNode {
  return obj instanceof DefinitionNode && Object.hasOwn(obj, "toJSON");
}

export function getSchemaObjects<T extends DefinitionNode[]>(definitions: T) {
  const objects: SerializedObject<SchemaObjectType>[] = [];

  for (const def of definitions) {
    if (isDefinitionInstance(def) && isSchemaObjectKind(def)) {
      objects.push(def.toJSON());
    }
  }

  return objects;
}

export function sortSchemaObjects<T extends SerializedSchema>(definitions: T): T {
  return definitions.sort((a, b) => {
    const aIndex = SCHEMA_OBJECT_ORDER.indexOf(a.kind);
    const bIndex = SCHEMA_OBJECT_ORDER.indexOf(b.kind);
    return aIndex - bIndex;
  });
}

export const STATEMENT_BREAKPOINT = `-- statement breakpoint`;

export const printSchema = (schema: DefinitionNode[]) => {
  const objects = getSchemaObjects(schema);
  const sorted = sortSchemaObjects(objects);

  const statements: DDLStatement[] = [];

  for (const obj of sorted) {
    if (obj.kind === "TABLE") {
      const columns = obj.columns.map((col) =>
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

      const constraints: TableConstraintExpression[] = [];

      for (const constraint of obj.constraints) {
        if (constraint.kind === "CHECK_CONSTRAINT") {
          constraints.push(
            ddl.check({
              name: constraint.name,
              expression: constraint.expression,
            })
          );

          continue;
        }

        if (constraint.kind === "PRIMARY_KEY_CONSTRAINT") {
          constraints.push(
            ddl.primaryKey({
              name: constraint.name,
              columns: constraint.columns,
              include: constraint.include,
            })
          );

          continue;
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

      const table = ddl.createTable({
        name: obj.name,
        ifNotExists: true,
        columns,
        constraints,
      });

      statements.push(table);

      if (obj.indexes) {
        for (const idx of obj.indexes) {
          const indexColumns = idx.columns.map((col) =>
            ddl.indexColumn({
              columnName: col.column,
              sortDirection: col.sortDirection,
              nulls: col.nulls,
            })
          );

          const index = ddl.createIndex({
            name: idx.name,
            tableName: obj.name,
            unique: idx.unique,
            columns: indexColumns,
            include: idx.include ?? undefined,
            nullsDistinct: idx.distinctNulls,
            ifNotExists: true,
          });

          statements.push(index);
        }
      }
    }
  }
};
