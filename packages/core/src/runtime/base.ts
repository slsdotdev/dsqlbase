/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  AnyTableDefinition,
  AnyTableRelations,
  DefinitionSchema,
  RelationsDefinition,
  TableDefinition,
} from "../definition/index.js";
import { UnionToIntersection } from "../utils/types.js";

/**
 * Schema Definition Types
 */

export type DefinitionTableName<TDefinition extends DefinitionSchema> = {
  [K in keyof TDefinition]: TDefinition[K] extends AnyTableDefinition ? K : never;
}[keyof TDefinition];

export type DefinitionRelationsTableName<TDefinition extends DefinitionSchema> = {
  [K in keyof TDefinition]: TDefinition[K] extends RelationsDefinition<
    infer TableDefinition,
    infer _
  >
    ? TableDefinition extends AnyTableDefinition
      ? TableDefinition["name"]
      : never
    : never;
}[keyof TDefinition];

/**
 * Every relation declared for `TTableName`, as one object.
 *
 * A table may be given several `relations()` blocks — the registry merges them, refusing a
 * name declared twice. Matching the blocks yields one map per block, as a union; `keyof` a
 * union keeps only the keys every member shares, so left as a union a table with two blocks
 * would have no relation names at all. The union is therefore collapsed into the merge the
 * registry performs. A table with no block still yields `never`: the intersection of nothing is
 * `unknown`, which the final check rejects.
 */
export type DefinitionTableRelations<
  TDefinition extends DefinitionSchema,
  TTableName extends string,
> = UnionToIntersection<
  TDefinition extends Record<string, infer Def>
    ? Def extends RelationsDefinition<infer TTable, infer R>
      ? TTable extends TableDefinition<TTableName, infer _, infer __>
        ? R extends AnyTableRelations
          ? R
          : never
        : never
      : never
    : never
> extends infer TMerged extends AnyTableRelations
  ? TMerged
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

/**
 * Table Relation Types
 */

export type SchemaTableRelations<TSchema extends AnySchema, TTableName extends string> =
  TSchema["relations"] extends Record<TTableName, infer R>
    ? R extends AnyTableRelations
      ? R
      : never
    : never;

export type TableRelationFieldName<
  TSchema extends AnySchema,
  TTableName extends string,
> = TTableName extends keyof TSchema["relations"]
  ? TSchema["relations"][TTableName] extends AnyTableRelations
    ? keyof TSchema["relations"][TTableName]
    : never
  : never;

export type FieldRelationConfig<
  TSchema extends AnySchema,
  TTableName extends string,
  TFieldName extends string,
> = TTableName extends keyof TSchema["relations"]
  ? TSchema["relations"][TTableName] extends AnyTableRelations
    ? TFieldName extends keyof TSchema["relations"][TTableName]
      ? TSchema["relations"][TTableName][TFieldName]
      : never
    : never
  : never;
