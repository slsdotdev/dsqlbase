import { DefinitionNode } from "../definition/base.js";
import { ColumnDefinitionType } from "../definition/column.js";
import { RelationsConfig, RelationsDefinition } from "../definition/index.js";
import { AnyTableDefinition, TableDefinition } from "../definition/table.js";
import { Prettify } from "../types/prettify.js";
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
        ? R["relations"]
        : never
      : never
    : never;

export type TableByName<TSchema extends AnySchema, TTableName extends string> = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  [K in keyof TSchema["tables"]]: TSchema["tables"][K] extends Table<TTableName, infer _, infer __>
    ? TSchema["tables"][K]
    : never;
}[keyof TSchema["tables"]];

export type Schema<T extends Record<string, DefinitionNode>> = Prettify<{
  tables: {
    [K in TableNameOf<T>]: T[K] extends TableDefinition<infer TName, infer TConfig>
      ? Table<TName, TConfig, TableRelations<T, TName>>
      : never;
  };
  relations: {
    [K in RelationNameOf<T>]: TableRelations<T, K>;
  };
}>;

export type AnySchema = Schema<Record<string, DefinitionNode>>;

export type ColumnValueOf<T extends ColumnDefinitionType> = T["__type"]["notNull"] extends true
  ? string
  : string | null | undefined;

export type CreateRecordOf<TTable extends AnyTable> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["__type"]["columns"][K] extends ColumnDefinitionType
    ? ColumnValueOf<TTable["__type"]["columns"][K]>
    : never;
};

export type SelectColumnsOf<TTable extends AnyTable> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["__type"]["columns"][K] extends ColumnDefinitionType
    ? boolean | null | undefined
    : never;
};

export interface CreateParams<TTable extends AnyTable> {
  data: CreateRecordOf<TTable>;
  return?: SelectColumnsOf<TTable>;
}
