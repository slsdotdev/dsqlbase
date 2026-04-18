import {
  AnyDomainDefinition,
  AnyTableDefinition,
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

export type DefinitionSchema<T extends DefinitionObject[]> = T extends (infer U)[]
  ? U extends DefinitionObject
    ? ReturnType<U["toJSON"]>
    : never
  : never;
