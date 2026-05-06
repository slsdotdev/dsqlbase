import { SQLValue } from "@dsqlbase/core";
import {
  AnyColumnDefinition,
  AnyNamespaceDefinition,
  AnyFieldRelation,
  AnyTableRelations,
  ColumnConfig,
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

export type FieldRelationOf<T extends AnyTable, K extends RelationFieldNamesOf<T>> =
  T["__type"]["relations"] extends Record<K, infer R>
    ? R extends AnyFieldRelation
      ? R
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

export type RelationTypeOf<T extends AnyTable, K extends RelationFieldNamesOf<T>> = FieldRelationOf<
  T,
  K
>["type"];

export type RelationTargetOf<
  T extends AnyTable,
  K extends RelationFieldNamesOf<T>,
> = FieldRelationOf<T, K>["target"];

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
  where: WhereExpressionOf<TTable>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export type DeleteArgs<TTable extends AnyTable> = Prettify<{
  where: WhereExpressionOf<TTable>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export interface QueryArgs<TTable extends AnyTable, TSchema extends AnySchema> {
  /**
   * Select specific fields to return in the query result. If not provided, all fields will be returned.
   *
   * @example
   * ```ts
   * client.findOne({
   *   where: { id: { eq: "123" } },
   *   select: {
   *     id: true,
   *     firstName: true,
   *   },
   * })
   * ```
   * @notes
   * * The `select` clause allows you to specify which fields to retrieve, if not provided, all fields will be selected by default.
   * * You can only select fields that exist on the table, attempting to select a non-existent field will result in a TypeScript error.
   *
   * @typeParam TTable - The table being queried, used for type inference of selectable fields.
   * @typeParam TSchema - The overall schema, used for type inference of relations in join expressions.
   */
  select?: FieldSelectionOf<TTable>;

  /**
   * A filter expression to specify which records to retrieve. This is optional for `findMany`, if not provided, all records will be returned.
   *
   * @example
   * ```ts
   * client.findMany({
   *   where: { published: true },
   * });
   * ```
   * @notes
   * * The `where` clause is optional for `findMany`, if not provided, all records will be returned.
   * * The `where` clause supports various filter conditions such as equality, inequality, range queries, and more.
   * * You can combine multiple conditions using logical operators like `and`, `or`, and `not`.
   * * The fields used in the `where` clause must exist on the table, attempting to filter by a non-existent field will result in a TypeScript error.
   *
   * @typeParam TTable - The table being queried, used for type inference of filterable fields.
   */

  where?: WhereExpressionOf<TTable>;
  /**
   * Specify the order in which to return the records. The keys must be field names of the table, and the values must be either "asc" for ascending order or "desc" for descending order.
   *
   * @example
   * ```ts
   * client.findMany({
   *   orderBy: { createdAt: "desc" },
   * });
   * ```
   * @notes
   * * The `orderBy` clause allows you to specify the order in which to return the records. The keys must be field names of the table, and the values must be either "asc" for ascending order or "desc" for descending order.
   * * You can specify multiple fields to order by, in which case the records will be ordered by the first field, and then by the second field in case of ties, and so on.
   * * The fields used in the `orderBy` clause must exist on the table, attempting to order by a non-existent field will result in a TypeScript error.
   *
   * @typeParam TTable - The table being queried, used for type inference of orderable fields.
   */
  orderBy?: OrderByExpressionOf<TTable>;

  /**
   * Specify that the query should return only distinct records based on the selected fields. This is useful when you want to eliminate duplicate records from the result set.
   *
   * @example
   * ```ts
   * client.findMany({
   *   where: { published: true },
   *   distinct: true,
   * });
   * ```
   * @notes
   * * The `distinct` flag indicates that the query should return only distinct records based on the selected fields. This is useful when you want to eliminate duplicate records from the result set.
   * * When `distinct` is true, the database will ensure that the returned records are unique based on the fields specified in the `select` clause. If no `select` clause is provided, all fields will be considered for determining uniqueness.
   * * The `distinct` flag is typically used in conjunction with the `select` clause to specify which fields should be considered when determining uniqueness. If you want to return distinct records based on specific fields, make sure to include those fields in the `select` clause.
   * * The behavior of the `distinct` flag may vary depending on the underlying database and how it handles distinct queries, especially when combined with joins and other query features.
   */
  distinct?: boolean;

  /**
   * Specify the maximum number of records to return and the number of records to skip. This is useful for implementing pagination in your queries.
   *
   * @example
   * ```ts
   * client.findMany({
   *   where: { published: true },
   *   limit: 10,
   *   offset: 20,
   * });
   * ```
   * @notes
   * * The `limit` parameter specifies the maximum number of records to return. If not provided, the default limit _(100)_ will be applied.
   * * The `offset` parameter specifies the number of records to skip before starting to return records. This is useful for implementing pagination in your queries. If not provided, no records will be skipped.
   * * When using `limit` and `offset` together, the query will return records starting from the `offset` position up to the number specified by `limit`. For example, if `offset` is 20 and `limit` is 10, the query will return records 21 through 30.
   */
  limit?: number;

  /**
   * The `offset` parameter specifies the number of records to skip before starting to return records. This is useful for implementing pagination in your queries. If not provided, no records will be skipped.
   *
   * @example
   * ```ts
   * client.findMany({
   *   where: { published: true },
   *   offset: 20,
   * });
   * ```
   * @notes
   * * The `offset` parameter specifies the number of records to skip before starting to return records. This is useful for implementing pagination in your queries. If not provided, no records will be skipped.
   * * When using `limit` and `offset` together, the query will return records starting from the `offset` position up to the number specified by `limit`. For example, if `offset` is 20 and `limit` is 10, the query will return records 21 through 30.
   */
  offset?: number;

  /**
   * Join related records based on the relations defined in the schema. The value can be a boolean or a nested query object for more complex queries.
   *
   * @example
   * ```ts
   * client.findOne({
   *   where: { id: "123" },
   *   select: {
   *     id: true,
   *     firstName: true,
   *   },
   *   join: {
   *     posts: {
   *       where: { published: true },
   *       select: {
   *         title: true,
   *       },
   *     },
   *     profile: true,
   *   },
   * })
   * ```
   */
  join?: Prettify<JoinExpressionOf<TTable, TSchema>>;
}

export interface FindOneArgs<TTable extends AnyTable, TSchema extends AnySchema> extends Pick<
  QueryArgs<TTable, TSchema>,
  "select" | "join"
> {
  /**
   * A filter expression to specify which record to retrieve. This is required for `findOne` to ensure that the operation is deterministic and does not accidentally return an unintended record.
   *
   * @example
   * ```ts
   * client.findOne({
   *   where: { id: { eq: "123" } },
   * });
   * ```
   * @notes
   * * The `where` clause is required for `findOne` to ensure that the operation is deterministic and does not accidentally return an unintended record.
   * * The `where` clause supports various filter conditions such as equality, inequality, range queries, and more.
   * * You can combine multiple conditions using logical operators like `and`, `or`, and `not`.
   * * The fields used in the `where` clause must exist on the table, attempting to filter by a non-existent field will result in a TypeScript error.
   *
   * @typeParam TTable - The table being queried, used for type inference of filterable fields.
   */
  where: WhereExpressionOf<TTable>;
}

export type RelationQueryOf<
  T extends AnyTable,
  S extends AnySchema,
  K extends RelationFieldNamesOf<T>,
> =
  RelationTargetOf<T, K> extends TableDefinition<infer TName, infer TCols, infer TSchema>
    ? RelationTypeOf<T, K> extends "has_many"
      ? QueryArgs<Table<TName, TCols, TSchema, SchemaTableRelations<S, TName>>, S>
      : Pick<
          QueryArgs<Table<TName, TCols, TSchema, SchemaTableRelations<S, TName>>, S>,
          "select" | "join"
        >
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
  TTargetCols extends Record<string, AnyColumnDefinition>,
  TTargetSchema extends AnyNamespaceDefinition,
> =
  RelationTypeOf<TTable, TRelationField> extends "has_many"
    ? QueryResultOf<
        Table<TTargetName, TTargetCols, TTargetSchema, SchemaTableRelations<TSchema, TTargetName>>,
        TSchema,
        TArgs
      >[]
    : QueryResultOf<
        Table<TTargetName, TTargetCols, TTargetSchema, SchemaTableRelations<TSchema, TTargetName>>,
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
      ? RelationTargetOf<TTable, K> extends TableDefinition<
          infer TName,
          infer TCols,
          infer TNamespace
        >
        ? TArgs["join"][K] extends QueryArgs<
            Table<TName, TCols, TNamespace, SchemaTableRelations<TSchema, TName>>,
            TSchema
          >
          ? RelationJoinResultOf<TTable, TSchema, TArgs["join"][K], K, TName, TCols, TNamespace>
          : TArgs["join"][K] extends boolean
            ? TArgs["join"][K] extends true
              ? RelationJoinResultOf<
                  TTable,
                  TSchema,
                  QueryArgs<
                    Table<TName, TCols, TNamespace, SchemaTableRelations<TSchema, TName>>,
                    TSchema
                  >,
                  K,
                  TName,
                  TCols,
                  TNamespace
                >
              : never
            : never
        : never
      : never;
  }
>;

export interface FilterCondition<Value = unknown> {
  /**
   * Equality condition - matches records where the field is equal to the specified value.
   *
   * ```sql
   * "table"."column" = value
   * ```
   */
  eq?: Value;

  /**
   * Inequality condition - matches records where the field is not equal to the specified value.
   *
   * ```sql
   * "table"."column" <> value
   * ```
   */
  neq?: Value;

  /**
   * Greater than condition - matches records where the field is greater than the specified value.
   *
   * ```sql
   * "table"."column" > value
   * ```
   */
  gt?: Value;

  /**
   * Greater than or equal condition - matches records where the field is greater than or equal to the specified value.
   *
   * ```sql
   * "table"."column" >= value
   * ```
   */
  gte?: Value;

  /**
   * Less than condition - matches records where the field is less than the specified value.
   *
   * ```sql
   * "table"."column" < value
   * ```
   */
  lt?: Value;

  /**
   * Less than or equal condition - matches records where the field is less than or equal to the specified value.
   *
   * ```sql
   * "table"."column" <= value
   * ```
   */
  lte?: Value;

  /**
   * In condition - matches records where the field is equal to any of the values in the specified array.
   *
   * ```sql
   * "table"."column" IN (value1, value2, ...)
   * ```
   */
  in?: Value[];

  /**
   * Between condition - matches records where the field is between the two specified values (inclusive).
   *
   * ```sql
   * "table"."column" BETWEEN value1 AND value2
   * ```
   */
  between?: [Value, Value];

  /**
   * Exists condition - matches records where the field exists (is not null).
   *
   * ```sql
   * "table"."column" IS NOT NULL
   * ```
   */
  exists?: boolean;

  /**
   * Begins with condition - matches records where the field starts with the specified string.
   *
   * ```sql
   * "table"."column" LIKE 'value%'
   * ```
   */
  beginsWith?: string;

  /**
   * Ends with condition - matches records where the field ends with the specified string.
   *
   * ```sql
   * "table"."column" LIKE '%value'
   * ```
   */
  endsWith?: string;

  /**
   * Contains condition - matches records where the field contains the specified string.
   *
   * ```sql
   * "table"."column" LIKE '%value%'
   * ```
   */
  contains?: string;
}

export type WhereExpressionOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]?: T["__type"]["columns"][K] extends AnyColumnDefinition
    ? FilterCondition<ValueTypeOf<ColumnTypeOf<T, K>>> | ValueTypeOf<ColumnTypeOf<T, K>>
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

export type AnyRelationQuery =
  | RelationQueryOf<AnyTable, AnySchema, RelationFieldNamesOf<AnyTable>>
  | boolean;

export function isFilterType<T extends keyof FilterCondition>(
  value: unknown,
  type: T
): value is Required<Pick<FilterCondition<SQLValue>, T>> {
  return (
    typeof value === "object" &&
    value !== null &&
    type in value &&
    value[type as keyof typeof value] !== undefined
  );
}
