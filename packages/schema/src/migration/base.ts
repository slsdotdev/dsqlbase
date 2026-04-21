import {
  AnyDomainDefinition,
  AnyNamespaceDefinition,
  AnyTableDefinition,
  DefinitionNode,
  NodeKind,
  SequenceDefinition,
  ViewDefinition,
} from "@dsqlbase/core";

export type SchemaObjectType =
  | AnyNamespaceDefinition
  | AnyDomainDefinition
  | AnyTableDefinition
  | SequenceDefinition<string>
  | ViewDefinition<string>;

export type SerializedObject<T extends SchemaObjectType> = ReturnType<T["toJSON"]>;

export type SerializedSchema<T extends SchemaObjectType[] = SchemaObjectType[]> =
  (T extends (infer U)[] ? (U extends SchemaObjectType ? SerializedObject<U> : never) : never)[];

/**
 * Root level definition kinds in the order they should be created to satisfy dependencies.
 */

export const ORDERED_SCHEMA_OBJECTS: NodeKind[] = [
  "SCHEMA",
  "DOMAIN",
  "TABLE",
  "SEQUENCE",
  "VIEW",
] as const;

export function isSchemaObjectKind(node: DefinitionNode): node is SchemaObjectType {
  return ORDERED_SCHEMA_OBJECTS.includes(node.kind);
}

export function isDefinitionInstance(obj: unknown): obj is DefinitionNode {
  return (
    typeof obj === "object" &&
    obj !== null &&
    Object.hasOwn(obj, "kind") &&
    typeof obj["toJSON" as keyof typeof obj] === "function"
  );
}

export function getSerializedSchemaObjects<T extends DefinitionNode[]>(definitions: T) {
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
    const aIndex = ORDERED_SCHEMA_OBJECTS.indexOf(a.kind);
    const bIndex = ORDERED_SCHEMA_OBJECTS.indexOf(b.kind);
    return aIndex - bIndex;
  });
}
