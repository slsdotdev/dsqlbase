import {
  AnyDomainDefinition,
  AnyNamespaceDefinition,
  AnySequenceDefinition,
  AnyTableDefinition,
  DefinitionNode,
  NodeKind,
  Kind,
} from "@dsqlbase/core/definition";

export type SchemaObjectType =
  | AnyNamespaceDefinition
  | AnyDomainDefinition
  | AnyTableDefinition
  | AnySequenceDefinition;
// | ViewDefinition<string>;

export type SerializedObject<T extends DefinitionNode> = ReturnType<T["toJSON"]>;

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
  // "VIEW",
] as const;

export function isSchemaObjectKind(node: DefinitionNode): node is SchemaObjectType {
  return ORDERED_SCHEMA_OBJECTS.includes(node.kind);
}

export function isDefinitionObject(
  obj: unknown
): obj is DefinitionNode | SerializedObject<DefinitionNode> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "kind" in obj &&
    Object.keys(Kind).includes(obj["kind"] as string) &&
    "name" in obj &&
    typeof obj["name"] === "string"
  );
}

export function isDefinitionInstance(obj: unknown): obj is DefinitionNode {
  return isDefinitionObject(obj) && typeof obj["toJSON" as keyof typeof obj] === "function";
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
