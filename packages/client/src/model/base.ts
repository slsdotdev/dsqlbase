import {
  AnyColumnDefinition,
  AnyFieldRelation,
  AnyTableRelations,
  ColumnConfig,
  TableConfig,
  TableDefinition,
} from "@dsqlbase/core/definition";
import { AnySchema, AnyTable, SchemaTableRelations, Table } from "@dsqlbase/core/runtime";
import { Prettify } from "@dsqlbase/core/utils";

export type FieldNamesOf<T extends AnyTable> = keyof T["__type"]["columns"] extends infer K
  ? K extends string
    ? T["__type"]["columns"][K] extends AnyColumnDefinition
      ? K
      : never
    : never
  : never;

export type RelationFieldNamesOf<T extends AnyTable> =
  T["__type"]["relations"] extends AnyTableRelations
    ? keyof T["__type"]["relations"] extends infer K
      ? K extends string
        ? T["__type"]["relations"][K] extends AnyFieldRelation
          ? K
          : never
        : never
      : never
    : never;

export type ColumnTypeOf<T extends AnyTable, K extends FieldNamesOf<T>> =
  T["__type"]["columns"] extends Record<K, infer TColumn>
    ? TColumn extends AnyColumnDefinition
      ? TColumn["__type"]
      : never
    : never;

export type ValueTypeOf<T extends ColumnConfig> = T extends ColumnConfig
  ? T["notNull"] extends true
    ? T["valueType"]
    : T["valueType"] | null
  : never;

export type FieldSelectionOf<T extends AnyTable> = Partial<Record<FieldNamesOf<T>, boolean>>;

export type SelectedFieldsOf<
  TTable extends AnyTable,
  TSelection extends FieldSelectionOf<TTable>,
> = {
  [K in keyof TSelection]: TSelection[K] extends true ? K : never;
}[keyof TSelection];

export type RequiredFieldsOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { notNull: true }
    ? ColumnTypeOf<T, K> extends { hasDefault: true }
      ? never
      : K
    : never;
}[FieldNamesOf<T>];

export type RelationTypeOf<T extends AnyTable, K extends RelationFieldNamesOf<T>> =
  T["__type"]["relations"] extends Record<K, infer R>
    ? R extends AnyFieldRelation
      ? R["type"]
      : never
    : never;

export type RelationTargetOf<T extends AnyTable, K extends RelationFieldNamesOf<T>> =
  T["__type"]["relations"] extends Record<K, infer R>
    ? R extends AnyFieldRelation
      ? R["target"]
      : never
    : never;

export type OptionalFieldsOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { notNull: true }
    ? ColumnTypeOf<T, K> extends { hasDefault: true }
      ? K
      : never
    : K;
}[FieldNamesOf<T>];

export type CreateValuesOf<T extends AnyTable> = {
  [K in RequiredFieldsOf<T>]: ValueTypeOf<ColumnTypeOf<T, K>>;
} & {
  [K in OptionalFieldsOf<T>]?: ValueTypeOf<ColumnTypeOf<T, K>>;
};

export type ReturningResultOf<T extends AnyTable, TArgs> = TArgs extends {
  return?: infer R;
}
  ? R extends FieldSelectionOf<T>
    ? {
        [K in SelectedFieldsOf<T, R>]: K extends FieldNamesOf<T>
          ? ValueTypeOf<ColumnTypeOf<T, K>>
          : never;
      }
    : R extends true
      ? { [K in FieldNamesOf<T>]: ValueTypeOf<ColumnTypeOf<T, K>> }
      : Record<string, never>
  : never;

export type CreateArgs<TTable extends AnyTable> = Prettify<{
  data: CreateValuesOf<TTable>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export type UpdateValuesOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]?: ValueTypeOf<ColumnTypeOf<T, K>>;
};

export type UpdateArgs<TTable extends AnyTable> = Prettify<{
  set: UpdateValuesOf<TTable>;
  where: Record<string, unknown>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export type DeleteArgs<TTable extends AnyTable> = Prettify<{
  where: Record<string, unknown>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export interface QueryArgs<TTable extends AnyTable, TSchema extends AnySchema> {
  select?: FieldSelectionOf<TTable>;
  join?: Prettify<JoinExpressionOf<TTable, TSchema>>;
}

export interface FindOneArgs<TTable extends AnyTable, TSchema extends AnySchema> extends QueryArgs<
  TTable,
  TSchema
> {
  where: WhereExpressionOf<TTable>;
}

export interface FindManyArgs<TTable extends AnyTable, TSchema extends AnySchema> extends QueryArgs<
  TTable,
  TSchema
> {
  where?: WhereExpressionOf<TTable>;
  orderBy?: OrderByExpressionOf<TTable>;
  distinct?: boolean;
  limit?: number;
  offset?: number;
}

export type RelationQueryOf<
  T extends AnyTable,
  S extends AnySchema,
  K extends RelationFieldNamesOf<T>,
> =
  T["__type"]["relations"] extends Record<K, infer R>
    ? R extends AnyFieldRelation
      ? R["target"] extends TableDefinition<infer TName, infer TConfig>
        ? R["type"] extends "has_many"
          ? FindManyArgs<Table<TName, TConfig, SchemaTableRelations<S, TName>>, S>
          : QueryArgs<Table<TName, TConfig, SchemaTableRelations<S, TName>>, S>
        : never
      : never
    : never;

export type SelectionResultOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends QueryArgs<TTable, TSchema>,
> =
  TArgs["select"] extends FieldSelectionOf<TTable>
    ? {
        [K in SelectedFieldsOf<TTable, TArgs["select"]>]: K extends FieldNamesOf<TTable>
          ? ValueTypeOf<ColumnTypeOf<TTable, K>>
          : never;
      }
    : { [K in FieldNamesOf<TTable>]: ValueTypeOf<ColumnTypeOf<TTable, K>> };

export type RelationJoinResultOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends QueryArgs<TTable, TSchema>,
  TRelationField extends RelationFieldNamesOf<TTable>,
  TTargetName extends string,
  TTargetConfig extends TableConfig,
> =
  RelationTypeOf<TTable, TRelationField> extends "has_many"
    ? QueryResultOf<
        Table<TTargetName, TTargetConfig, SchemaTableRelations<TSchema, TTargetName>>,
        TSchema,
        TArgs
      >[]
    : QueryResultOf<
        Table<TTargetName, TTargetConfig, SchemaTableRelations<TSchema, TTargetName>>,
        TSchema,
        TArgs
      > | null;

export type QueryResultOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends QueryArgs<TTable, TSchema>,
> = Prettify<
  SelectionResultOf<TTable, TSchema, TArgs> & {
    [K in keyof TArgs["join"]]: K extends RelationFieldNamesOf<TTable>
      ? RelationTargetOf<TTable, K> extends TableDefinition<infer TName, infer TConfig>
        ? TArgs["join"][K] extends QueryArgs<
            Table<TName, TConfig, SchemaTableRelations<TSchema, TName>>,
            TSchema
          >
          ? RelationJoinResultOf<TTable, TSchema, TArgs["join"][K], K, TName, TConfig>
          : TArgs["join"][K] extends boolean
            ? TArgs["join"][K] extends true
              ? RelationJoinResultOf<
                  TTable,
                  TSchema,
                  QueryArgs<Table<TName, TConfig, SchemaTableRelations<TSchema, TName>>, TSchema>,
                  K,
                  TName,
                  TConfig
                >
              : never
            : never
        : never
      : never;
  }
>;

export interface FilterCondition<Value = unknown> {
  eq?: Value;
  ne?: Value;
  gt?: Value;
  gte?: Value;
  lt?: Value;
  lte?: Value;
  in?: Value[];
  between?: [Value, Value];
  exists?: boolean;
  beginsWith?: string;
  endsWith?: string;
  contains?: string;
}

export type WhereExpressionOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]?: T["__type"]["columns"][K] extends AnyColumnDefinition
    ? FilterCondition<ValueTypeOf<ColumnTypeOf<T, K>>>
    : never;
} & {
  and?: WhereExpressionOf<T>[];
  or?: WhereExpressionOf<T>[];
  not?: WhereExpressionOf<T>;
};

export type OrderByExpressionOf<T extends AnyTable> = Partial<
  Record<FieldNamesOf<T>, "asc" | "desc">
>;

export type JoinExpressionOf<T extends AnyTable, S extends AnySchema> = {
  [K in RelationFieldNamesOf<T>]?: RelationQueryOf<T, S, K> | boolean | null | undefined;
};
