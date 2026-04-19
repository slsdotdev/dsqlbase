import {
  AnyDomainDefinition,
  AnyTableDefinition,
  DefinitionNode,
  SchemaDefinition,
  SequenceDefinition,
  ViewDefinition,
} from "@dsqlbase/core";

export type DefinitionObject =
  | AnyTableDefinition
  | SchemaDefinition
  | AnyDomainDefinition
  | SequenceDefinition<string>
  | ViewDefinition<string>;

export type SerializedObject<T extends DefinitionNode> = ReturnType<T["toJSON"]>;

export type SerializedSchema<T extends DefinitionObject[] = DefinitionObject[]> =
  (T extends (infer U)[] ? (U extends DefinitionObject ? SerializedObject<U> : never) : never)[];
