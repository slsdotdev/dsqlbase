/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  AnyFieldRelation,
  AnyTableDefinition,
  AnyTableRelations,
  DefinitionSchema,
  FieldRelation,
  RelationsConfig,
  RelationsDefinition,
} from "../definition/index.js";

/**
 * Schema Definition Types
 */

export type DefinitionTableName<TDefinition extends DefinitionSchema> = {
  [K in keyof TDefinition]: TDefinition[K] extends AnyTableDefinition ? K : never;
}[keyof TDefinition];

export type DefinitionRelationsTableName<TDefinition extends DefinitionSchema> = {
  [K in keyof TDefinition]: TDefinition[K] extends RelationsDefinition<infer TableName, infer _>
    ? TableName
    : never;
}[keyof TDefinition];

export type DefinitionTableRelations<
  TDefinition extends DefinitionSchema,
  TTableName extends string,
> =
  TDefinition extends Record<string, infer Def>
    ? Def extends RelationsDefinition<TTableName, infer R>
      ? R extends RelationsConfig
        ? R["relations"] extends AnyTableRelations
          ? R["relations"]
          : never
        : never
      : never
    : never;

export type SchemaTableDefinitions<TDefinition extends DefinitionSchema> = {
  [K in DefinitionTableName<TDefinition>]: TDefinition[K] extends AnyTableDefinition
    ? TDefinition[K]
    : never;
};

export type SchemaRelationDefinitions<T extends DefinitionSchema> = {
  [K in DefinitionRelationsTableName<T>]: DefinitionTableRelations<T, K>;
};

export interface Schema<T extends DefinitionSchema> {
  tables: SchemaTableDefinitions<T>;
  relations: SchemaRelationDefinitions<T>;
}

export type AnySchema = Schema<DefinitionSchema>;

export type SchemaTableRelations<TSchema extends AnySchema, TTableName extends string> =
  TSchema["relations"] extends Record<TTableName, infer R>
    ? R extends AnyTableRelations
      ? R
      : never
    : never;

/**
 * Table Relation Types
 */

export type TableRelationFieldName<
  TSchema extends AnySchema,
  TTableName extends string,
> = TTableName extends keyof TSchema["relations"]
  ? TSchema["relations"][TTableName] extends RelationsDefinition<TTableName, infer RelConfig>
    ? RelConfig extends RelationsConfig
      ? keyof RelConfig["relations"]
      : never
    : never
  : never;

export type FieldRelationConfig<
  TSchema extends AnySchema,
  TTableName extends string,
  TFieldName extends string,
> = TTableName extends keyof TSchema["relations"]
  ? TSchema["relations"][TTableName] extends RelationsDefinition<TTableName, infer RelConfig>
    ? RelConfig extends RelationsConfig
      ? TFieldName extends keyof RelConfig["relations"]
        ? RelConfig["relations"][TFieldName]
        : never
      : never
    : never
  : never;
