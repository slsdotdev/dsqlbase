import {
  AnyColumnDefinition,
  AnyFieldRelation,
  AnySchema,
  AnyTable,
  AnyTableRelations,
  AnyUnion,
  ColumnConfig,
  ColumnRuntimeType,
  SchemaTableRelations,
  Table,
  TableDefinition,
  Union,
  UnionDefinition,
} from "@dsqlbase/core";
import { Prettify } from "@dsqlbase/core/utils";
import { OperatorsOf, OrderableRuntimeType, ShorthandRuntimeType } from "./operators.js";
import { TableByAlias } from "@dsqlbase/core/runtime";

export type RuntimeObject = AnyTable | AnyUnion;

/** An object's column fields — not its deprecated columns. */
export type FieldNamesOf<T extends RuntimeObject> = keyof T["__type"]["columns"] extends infer K
  ? K extends string
    ? T["__type"]["columns"][K] extends AnyColumnDefinition
      ? T["__type"]["columns"][K] extends { __type: { deprecated: true } }
        ? never
        : K
      : never
    : never
  : never;

export type RelationFieldNamesOf<T extends RuntimeObject> =
  T["__type"]["relations"] extends AnyTableRelations
    ? keyof T["__type"]["relations"] extends infer K
      ? K extends string
        ? T["__type"]["relations"][K] extends AnyFieldRelation
          ? K
          : never
        : never
      : never
    : never;

export type ColumnTypeOf<T extends RuntimeObject, K extends FieldNamesOf<T>> =
  T["__type"]["columns"] extends Record<K, infer TColumn>
    ? TColumn extends AnyColumnDefinition
      ? TColumn["__type"]
      : never
    : never;

export type FieldRelationOf<T extends RuntimeObject, K extends RelationFieldNamesOf<T>> =
  T["__type"]["relations"] extends Record<K, infer R>
    ? R extends AnyFieldRelation
      ? R
      : never
    : never;

export type ValueTypeOf<T extends ColumnConfig> = T extends ColumnConfig
  ? T["notNull"] extends true
    ? DeclaredTypeOf<T["runtimeType"], T["valueType"]>
    : DeclaredTypeOf<T["runtimeType"], T["valueType"]> | null
  : never;

/** What a write accepts for a column: its input type, nullable unless the column is not null. */
export type InputTypeOf<T extends ColumnConfig> = T extends ColumnConfig
  ? T["notNull"] extends true
    ? DeclaredTypeOf<T["runtimeType"], T["inputType"]>
    : DeclaredTypeOf<T["runtimeType"], T["inputType"]> | null
  : never;

/**
 * `V`, unless it is untyped on a column whose shape is checked: an untyped `array()` reads and
 * writes as `unknown[]`, an untyped `record()` as `Record<string, unknown>`. The column's own
 * value type stays `unknown`, so that `$type<T>()` gives exactly `T`.
 */
type DeclaredTypeOf<R extends ColumnRuntimeType, V> = unknown extends V
  ? R extends "array"
    ? unknown[]
    : R extends "object"
      ? Record<string, unknown>
      : V
  : V;

/**
 * The metadata a table declared with `table().meta()`, or `object` when it declared none.
 * Accepts a `Table` or a `TableDefinition` — both carry it on `__type`.
 */
export type DeclaredMetaOf<T> = T extends { __type: { meta: infer M } }
  ? M extends Record<string, unknown>
    ? M
    : object
  : object;

/** The columns a `return` may name. A read's `select` also takes relations: {@link SelectionOf}. */
export type SelectableFieldsOf<T extends RuntimeObject> = Partial<
  Record<FieldNamesOf<T>, boolean | null | undefined>
>;

export type SelectableRelationsOf<T extends RuntimeObject, S extends AnySchema> = Partial<{
  [K in RelationFieldNamesOf<T>]?: RelationSelectionOf<T, S, K> | boolean | null | undefined;
}>;

export type SelectionOf<T extends RuntimeObject, S extends AnySchema> = SelectableFieldsOf<T> &
  SelectableRelationsOf<T, S>;

export type RelationSelectionOf<
  T extends RuntimeObject,
  S extends AnySchema,
  R extends RelationFieldNamesOf<T>,
> =
  RelationTargetOf<T, R> extends TableDefinition<infer TName, infer TCols, infer TNamespace>
    ? SelectionOf<Table<TName, TCols, TNamespace, SchemaTableRelations<S, TName>>, S>
    : RelationTargetOf<T, R> extends UnionDefinition<infer UMembers, infer UColumns>
      ? SelectionOf<Union<UMembers, UColumns, SchemaTableRelations<S, R & string>>, S>
      : never;

export type RelationTargetOf<
  T extends RuntimeObject,
  K extends RelationFieldNamesOf<T>,
> = FieldRelationOf<T, K>["target"];

export type JoinExpressionOf<T extends RuntimeObject, S extends AnySchema> = {
  [K in RelationFieldNamesOf<T>]?: RelationQueryOf<T, S, K> | boolean | null | undefined;
};

export type RelationQueryOf<
  T extends RuntimeObject,
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
    : RelationTargetOf<T, K> extends UnionDefinition<infer UMembers, infer UColumns>
      ? RelationTypeOf<T, K> extends "has_many"
        ? UnionQueryArgs<Union<UMembers, UColumns, SchemaTableRelations<S, K & string>>, S>
        : Pick<
            UnionQueryArgs<Union<UMembers, UColumns, SchemaTableRelations<S, K & string>>, S>,
            "select" | "join" | "on"
          >
      : never;

export type RelationTypeOf<
  T extends RuntimeObject,
  K extends RelationFieldNamesOf<T>,
> = FieldRelationOf<T, K>["type"];

export type OrderByExpressionOf<T extends RuntimeObject> = Partial<
  Record<OrderableFieldNamesOf<T>, "asc" | "desc">
>;

/** The fields of a table that can be ordered by: not documents, arrays or binary. */
export type OrderableFieldNamesOf<T extends RuntimeObject> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K>["runtimeType"] extends OrderableRuntimeType
    ? K
    : never;
}[FieldNamesOf<T>];

/**
 * What to do with each member of a set of tables a single call may resolve to — the members
 * of a union, or every node a global id may name.
 *
 * `true` — or leaving the alias out — runs the member as it is; `false` excludes it, so it is
 * gone from the result union and refused at runtime. An object adds member-only arguments: a
 * `select`, a `where` AND-ed with whatever else filters it, and a `join` over its own relations.
 */
export type OnSelectionOf<TUnion extends AnyUnion, TSchema extends AnySchema> = {
  [K in UnionMembersOf<TUnion>]?:
    | Pick<QueryArgs<TableByAlias<TSchema, K>, TSchema>, "select" | "where" | "join">
    | boolean;
};

type UnionMembersOf<TUnion extends AnyUnion> = keyof TUnion["__type"]["members"] & string;

export type CreateValuesOf<T extends AnyTable> = {
  [K in Exclude<RequiredFieldsOf<T>, ReadOnlyFieldsOf<T>>]: InputTypeOf<ColumnTypeOf<T, K>>;
} & {
  [K in Exclude<OptionalFieldsOf<T>, ReadOnlyFieldsOf<T>>]?: InputTypeOf<ColumnTypeOf<T, K>>;
};

export type UpdateValuesOf<T extends AnyTable> = {
  [K in Exclude<FieldNamesOf<T>, ReadOnlyFieldsOf<T>>]?: InputTypeOf<ColumnTypeOf<T, K>>;
};

export type RequiredFieldsOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { notNull: true }
    ? ColumnTypeOf<T, K> extends { hasDefault: true }
      ? never
      : K
    : never;
}[FieldNamesOf<T>];

/**
 * Fields the caller may not write. They stay fully readable — selectable, filterable and
 * orderable — and are only removed from the two mutation inputs.
 */
export type ReadOnlyFieldsOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { readOnly: true } ? K : never;
}[FieldNamesOf<T>];

export type OptionalFieldsOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { notNull: true }
    ? ColumnTypeOf<T, K> extends { hasDefault: true }
      ? K
      : never
    : K;
}[FieldNamesOf<T>];

/*
 * -------------------------------------------------------------------------------------------
 * Filters
 * ----------------------------------------------------------------------------------------
 */

export type FilterCondition<Value = unknown> = {
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
   * Contains condition. On a string column, matches records where the field contains the
   * specified string; on a `jsonb` column, where the document contains the specified fragment
   * (see {@link ContainsValueOf}).
   *
   * ```sql
   * "table"."column" LIKE '%value%'
   * "table"."column" @> '{"fragment":true}'
   * ```
   */
  contains?: string;

  /**
   * Key condition, on a `record()` column - matches records whose object has the key at its top
   * level.
   *
   * ```sql
   * "table"."column" ? 'key'
   * ```
   */
  hasKey?: string;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  where?: Value extends Record<infer K, infer _>
    ? { [P in K]?: FilterOf<ColumnRuntimeType, Value[P]> }
    : never;
};

/**
 * A filter on a value of runtime type `R` holding `V`: the operators the runtime type allows,
 * and, where it allows one, a bare value meaning `{ eq: value }`. Mirrors
 * {@link RUNTIME_TYPE_RULES}, which {@link WhereBuilder} enforces.
 */
export type FilterOf<R extends ColumnRuntimeType, V> =
  | Prettify<Pick<FilterCondition<V>, OperatorsOf<R>>>
  | (ShorthandRuntimeType<R> extends true ? V : never);

export type WhereExpressionOf<T extends RuntimeObject> = {
  [K in FieldNamesOf<T>]?: T["__type"]["columns"][K] extends AnyColumnDefinition
    ?
        | FilterOf<ColumnTypeOf<T, K>["runtimeType"], ValueTypeOf<ColumnTypeOf<T, K>>>
        | null
        | undefined
    : never;
} & Partial<AndExpression<T> & OrExpression<T> & NotExpression<T>>;

type AndExpression<T extends RuntimeObject> = {
  and: WhereExpressionOf<T>[];
};

type OrExpression<T extends RuntimeObject> = {
  or: WhereExpressionOf<T>[];
};

type NotExpression<T extends RuntimeObject> = {
  not: WhereExpressionOf<T>;
};

/*
 * -------------------------------------------------------------------------------------------
 * Queries
 * ----------------------------------------------------------------------------------------
 */

export type QueryArgs<TTable extends RuntimeObject, TSchema extends AnySchema> = Prettify<{
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
   *
   */
  select?: SelectionOf<TTable, TSchema>;

  /**
   * A filter expression to specify which records to retrieve. This is optional for `findMany`, if not provided, all records will be returned.
   *
   * @example
   * ```ts
   * client.findMany({
   *   where: { published: true },
   * });
   * ```
   *
   */
  where?: WhereExpressionOf<TTable>;

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

  /**
   * Specify the order in which to return the records. The keys must be field names of the table, and the values must be either "asc" for ascending order or "desc" for descending order.
   *
   * @example
   * ```ts
   * client.findMany({
   *   orderBy: { createdAt: "desc" },
   * });
   * ```
   *
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
   *
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
   *
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
   *
   */
  offset?: number;
}>;

export type CountArgs<TTable extends AnyTable> = {
  where?: WhereExpressionOf<TTable>;
};

export type UnionQueryArgs<TUnion extends AnyUnion, TSchema extends AnySchema> = Prettify<
  QueryArgs<TUnion, TSchema> & {
    /**
     * Per member: `false` drops it, `true` (or leaving it out) runs it with the shared arguments,
     * and an object adds a member-only `select`, `where` and `join`.
     */
    on?: Prettify<OnSelectionOf<TUnion, TSchema>>;
  }
>;

/*
 * -------------------------------------------------------------------------------------------
 * Mutations
 * ----------------------------------------------------------------------------------------
 */

export type CreateArgs<TTable extends AnyTable> = Prettify<{
  data: CreateValuesOf<TTable>;
  return?: SelectableFieldsOf<TTable> | boolean | null | undefined;
}>;

export type UpdateArgs<TTable extends AnyTable> = Prettify<{
  set: UpdateValuesOf<TTable>;
  where: WhereExpressionOf<TTable>;
  return?: SelectableFieldsOf<TTable> | boolean | null | undefined;
}>;

export type DeleteArgs<TTable extends AnyTable> = Prettify<{
  where: WhereExpressionOf<TTable>;
  return?: SelectableFieldsOf<TTable> | boolean | null | undefined;
}>;
