import { DefinitionNode } from "../definition/base.js";
import {
  AnyColumnDefinition,
  Relation,
  RelationsConfig,
  RelationsDefinition,
} from "../definition/index.js";
import { AnyTableRelations } from "../definition/relations.js";
import { AnyTableDefinition } from "../definition/table.js";
import { Prettify, UnionToIntersection } from "../types/prettify.js";
import { AnyTable, Table } from "./table.js";

export type TableNameOf<TSchema extends Record<string, DefinitionNode>> = {
  [K in keyof TSchema]: TSchema[K] extends AnyTableDefinition ? K : never;
}[keyof TSchema];

export type RelationNameOf<TSchema extends Record<string, DefinitionNode>> = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  [K in keyof TSchema]: TSchema[K] extends RelationsDefinition<infer TableName, infer _>
    ? TableName
    : never;
}[keyof TSchema];

export type TableRelations<
  TSchema extends Record<string, DefinitionNode>,
  TTableName extends string,
> =
  TSchema extends Record<string, infer Def>
    ? Def extends RelationsDefinition<TTableName, infer R>
      ? R extends RelationsConfig
        ? R["relations"] extends Record<string, Relation<AnyTableDefinition, AnyTableDefinition>>
          ? { [K in keyof R["relations"]]: R["relations"][K] }
          : never
        : never
      : never
    : never;

export type TableByName<TSchema extends AnySchema, TTableName extends string> = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  [K in keyof TSchema["tables"]]: TSchema["tables"][K] extends Table<TTableName, infer _, infer __>
    ? TSchema["tables"][K]
    : never;
}[keyof TSchema["tables"]];

export type SchemaTables<TSchema extends Record<string, DefinitionNode>> = {
  [K in keyof TSchema]: TSchema[K] extends AnyTableDefinition ? TSchema[K] : never;
};

export type SchemaRelations<T extends Record<string, DefinitionNode>> = {
  [K in RelationNameOf<T>]: UnionToIntersection<TableRelations<T, K>>;
};

export type Schema<T extends Record<string, DefinitionNode>> = Prettify<{
  tables: SchemaTables<T>;
  relations: SchemaRelations<T>;
}>;

export type SchemaRelationsOf<S extends AnySchema, T extends string> =
  S["relations"] extends Record<T, infer R> ? (R extends AnyTableRelations ? R : never) : never;

export type AnySchema = Schema<Record<string, DefinitionNode>>;

export type ColumnValueOf<T extends AnyColumnDefinition> = T["__type"]["notNull"] extends true
  ? string
  : string | null | undefined;

export type CreateRecordOf<TTable extends AnyTable> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["__type"]["columns"][K] extends AnyColumnDefinition
    ? ColumnValueOf<TTable["__type"]["columns"][K]>
    : never;
};

export type SelectColumnsOf<TTable extends AnyTable> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["__type"]["columns"][K] extends AnyColumnDefinition
    ? boolean | null | undefined
    : never;
};

export interface CreateParams<TTable extends AnyTable> {
  data: CreateRecordOf<TTable>;
  return?: SelectColumnsOf<TTable>;
}
