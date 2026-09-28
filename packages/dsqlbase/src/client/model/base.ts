import { SQLValue } from "@dsqlbase/core";
import {
  AnyColumnDefinition,
  AnyNamespaceDefinition,
  AnyFieldRelation,
  AnyTableRelations,
  AnyUnionMembers,
  ColumnConfig,
  SharedFieldsOf,
  TableDefinition,
  UnionDefinition,
} from "@dsqlbase/core/definition";
import {
  AnySchema,
  AnyTable,
  SchemaTableRelations,
  Table,
  TableByAlias,
} from "@dsqlbase/core/runtime";
import { Prettify, WithMeta } from "@dsqlbase/core/utils";

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

/**
 * The metadata a table declared with `table().meta()`, or `object` when it declared none.
 * Accepts a `Table` or a `TableDefinition` — both carry it on `__type`.
 */
export type DeclaredMetaOf<T> = T extends { __type: { meta: infer M } }
  ? M extends Record<string, unknown>
    ? M
    : object
  : object;

/**
 * The aliases a schema exports a given table under, matched on the database table name.
 *
 * Matched on the *name* rather than on the whole table type because a join level rebuilds its
 * target table from parts (`RelationJoinResultOf`), and the rebuilt type is not identical to
 * the one `TableByAlias` produces — structural matching finds the root level and misses every
 * nested one. The name is the reliable handle, and `SchemaRegistry` already keys its table map
 * by it, so two tables in one schema cannot share one.
 */
type MatchingAliasesOf<TSchema extends AnySchema, TTable extends AnyTable> = {
  [K in keyof TSchema["tables"] & string]: TableByAlias<TSchema, K>["name"] extends TTable["name"]
    ? TTable["name"] extends TableByAlias<TSchema, K>["name"]
      ? K
      : never
    : never;
}[keyof TSchema["tables"] & string];

/**
 * The literal alias a schema exports a table under, for `$$meta.key`.
 *
 * A reverse lookup, because the alias is a property of the *schema* — the key a table is
 * exported under — and nothing on `Table` carries it as a type. Falls back to `string` when
 * the table is not in the schema, so a hand-built `Table` still types.
 */
export type AliasOf<TSchema extends AnySchema, TTable extends AnyTable> = [
  MatchingAliasesOf<TSchema, TTable>,
] extends [never]
  ? string
  : MatchingAliasesOf<TSchema, TTable>;

/**
 * The `$$meta` property carried by every result record: built-ins set from the schema, plus
 * whatever `table().meta()` declared.
 *
 * `key` is the schema alias — the name the client addresses the table by, and the
 * discriminant a row union narrows on. It is the literal alias wherever the schema is in
 * hand, and `string` otherwise.
 */
export type RecordMetaOf<T, TAlias extends string = string> = Prettify<
  { key: TAlias; table: string; schema?: string } & DeclaredMetaOf<T>
>;

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

/**
 * Fields the caller may not write. They stay fully readable — selectable, filterable and
 * orderable — and are only removed from the two mutation inputs.
 */
export type ReadOnlyFieldsOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { readOnly: true } ? K : never;
}[FieldNamesOf<T>];

/**
 * The claim fields a table is scoped by — the keys an identity must carry for it to be
 * readable. Empty for a global table.
 */
export type TenantKeysOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { tenantKey: true } ? K : never;
}[FieldNamesOf<T>];

export type CreateValuesOf<T extends AnyTable> = {
  [K in Exclude<RequiredFieldsOf<T>, ReadOnlyFieldsOf<T>>]: ValueTypeOf<ColumnTypeOf<T, K>>;
} & {
  [K in Exclude<OptionalFieldsOf<T>, ReadOnlyFieldsOf<T>>]?: ValueTypeOf<ColumnTypeOf<T, K>>;
};

export type ReturningResultOf<
  T extends AnyTable,
  TArgs,
  TAlias extends string = string,
> = TArgs extends {
  return?: infer R;
}
  ? R extends FieldSelectionOf<T>
    ? Prettify<
        {
          [K in SelectedFieldsOf<T, R>]: K extends FieldNamesOf<T>
            ? ValueTypeOf<ColumnTypeOf<T, K>>
            : never;
        } & { $$meta: RecordMetaOf<T, TAlias> }
      >
    : R extends true
      ? Prettify<
          { [K in FieldNamesOf<T>]: ValueTypeOf<ColumnTypeOf<T, K>> } & {
            $$meta: RecordMetaOf<T, TAlias>;
          }
        >
      : Record<string, never>
  : never;

export type CreateArgs<TTable extends AnyTable> = Prettify<{
  data: CreateValuesOf<TTable>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export type UpdateValuesOf<T extends AnyTable> = {
  [K in Exclude<FieldNamesOf<T>, ReadOnlyFieldsOf<T>>]?: ValueTypeOf<ColumnTypeOf<T, K>>;
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
   * * The `limit` parameter specifies the maximum number of records to return. If not provided, no limit is applied and every matching record is returned.
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

export interface PaginateArgs<TTable extends AnyTable, TSchema extends AnySchema> extends Pick<
  QueryArgs<TTable, TSchema>,
  "select" | "where" | "orderBy" | "join"
> {
  /**
   * The number of records on the page. Defaults to the client's `pagination.defaultLimit`
   * (100 unless configured), and may not exceed its `pagination.maxLimit` when one is set.
   */
  limit?: number;

  /**
   * Read the page that follows this cursor — a `startCursor`, `endCursor` or record
   * `$$meta.cursor` from an earlier page taken under the same `orderBy`.
   */
  after?: string | null;

  /** Read the page that precedes this cursor. Never together with `after`. */
  before?: string | null;

  /**
   * Also count every record `where` selects, as `totalCount`. A second statement, and a full
   * read of the filtered rows on every page — hence opt-in.
   */
  count?: boolean;
}

/** One record of a page: a query result whose `$$meta` also carries its own cursor. */
export type PageItemOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends PaginateArgs<TTable, TSchema>,
> = Prettify<
  Omit<QueryResultOf<TTable, TSchema, TArgs>, "$$meta"> & {
    $$meta: Prettify<RecordMetaOf<TTable, AliasOf<TSchema, TTable>> & { cursor: string }>;
  }
>;

// Keyed on whether the caller wrote `count` at all: `TArgs["count"]` would read the constraint's
// `boolean | undefined` when they left it out. A `count` typed `boolean` is "maybe".
type TotalCountOf<TArgs> = "count" extends keyof TArgs
  ? [TArgs["count" & keyof TArgs]] extends [true]
    ? { totalCount: number }
    : [TArgs["count" & keyof TArgs]] extends [false | undefined]
      ? unknown
      : { totalCount?: number }
  : unknown;

export type PageOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends PaginateArgs<TTable, TSchema>,
> = Prettify<
  {
    items: PageItemOf<TTable, TSchema, TArgs>[];
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    /** The first item's cursor, or `null` on an empty page. */
    startCursor: string | null;
    /** The last item's cursor, or `null` on an empty page. */
    endCursor: string | null;
  } & TotalCountOf<TArgs>
>;

export interface CountArgs<TTable extends AnyTable> {
  where?: WhereExpressionOf<TTable>;
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
    : RelationTargetOf<T, K> extends UnionDefinition<infer TMembers>
      ? RelationTypeOf<T, K> extends "has_many"
        ? UnionQueryArgs<TMembers, S>
        : Pick<UnionQueryArgs<TMembers, S>, "select" | "orderBy" | "on">
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
  TTargetMeta = object,
> =
  RelationTypeOf<TTable, TRelationField> extends "has_many"
    ? QueryResultOf<
        WithMeta<
          Table<
            TTargetName,
            TTargetCols,
            TTargetSchema,
            SchemaTableRelations<TSchema, TTargetName>
          >,
          TTargetMeta
        >,
        TSchema,
        TArgs
      >[]
    : QueryResultOf<
        WithMeta<
          Table<
            TTargetName,
            TTargetCols,
            TTargetSchema,
            SchemaTableRelations<TSchema, TTargetName>
          >,
          TTargetMeta
        >,
        TSchema,
        TArgs
      > | null;

export type QueryResultOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends QueryArgs<TTable, TSchema>,
> = Prettify<
  SelectionResultOf<TTable, TSchema, TArgs> & {
    $$meta: RecordMetaOf<TTable, AliasOf<TSchema, TTable>>;
  } & {
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
          ? RelationJoinResultOf<
              TTable,
              TSchema,
              TArgs["join"][K],
              K,
              TName,
              TCols,
              TNamespace,
              DeclaredMetaOf<RelationTargetOf<TTable, K>>
            >
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
                  TNamespace,
                  DeclaredMetaOf<RelationTargetOf<TTable, K>>
                >
              : never
            : never
        : RelationTargetOf<TTable, K> extends UnionDefinition<infer TMembers>
          ? UnionJoinResultOf<
              TMembers,
              TSchema,
              TArgs["join"][K] extends UnionQueryArgs<TMembers, TSchema>
                ? TArgs["join"][K]
                : object,
              RelationTypeOf<TTable, K>
            >
          : never
      : never;
  }
>;

/* -------------------------------------------------------------------------------------------
 * Unions
 * ---------------------------------------------------------------------------------------- */

/** The value a shared field holds, across every member of a union. */
type SharedValueOf<TMembers extends AnyUnionMembers, K extends PropertyKey> = {
  [A in keyof TMembers]: TMembers[A]["__type"]["columns"][K] extends AnyColumnDefinition
    ? ValueTypeOf<TMembers[A]["__type"]["columns"][K]["__type"]>
    : never;
}[keyof TMembers];

/**
 * A filter on which member a row comes from. Decided while the query is built, member by
 * member, so a member that cannot match produces no branch — it never reaches SQL.
 */
export type KeyFilterOf<TAlias extends string> =
  | TAlias
  | { eq?: TAlias; neq?: TAlias; in?: TAlias[] };

/**
 * A `where` over a union's shared fields — the only ones that filter across it — and `$$key`.
 *
 * `$$key` narrows the query, not the result type: its value is usually a runtime one (a
 * resolver argument), so the members it rules out stay in the type. Use `on: { alias: false }`
 * to remove a member from both.
 */
export type UnionWhereExpressionOf<TMembers extends AnyUnionMembers> = {
  [K in SharedFieldsOf<TMembers>]?:
    | FilterCondition<SharedValueOf<TMembers, K>>
    | SharedValueOf<TMembers, K>;
} & {
  $$key?: KeyFilterOf<keyof TMembers & string>;
  and?: UnionWhereExpressionOf<TMembers>[];
  or?: UnionWhereExpressionOf<TMembers>[];
  not?: UnionWhereExpressionOf<TMembers>;
};

/**
 * A select over a union: shared-level `select` / `where` / `orderBy` / `limit` / `offset`, which
 * every member runs, plus `on` for what differs per member — GraphQL's `... on Photo { }`.
 */
export interface UnionQueryArgs<TMembers extends AnyUnionMembers, TSchema extends AnySchema> {
  /** Shared fields to return from every member; merged with each member's `on.<alias>.select`. */
  select?: Partial<Record<SharedFieldsOf<TMembers>, boolean>>;
  /** Applied inside every member's branch, AND-ed with its `on.<alias>.where`. */
  where?: UnionWhereExpressionOf<TMembers>;
  /**
   * Orders the combined rows, by shared fields and by `$$key` (member alias). Ties are broken
   * by member alias and then the primary key, so the order is total whenever the members' keys
   * line up.
   */
  orderBy?: Partial<Record<SharedFieldsOf<TMembers> | "$$key", "asc" | "desc">>;
  limit?: number;
  offset?: number;
  /**
   * Per member: `false` drops it, `true` (or leaving it out) runs it with the shared arguments,
   * and an object adds a member-only `select`, `where` and `join`.
   */
  on?: OnSelectionOf<keyof TMembers & string, TSchema>;
}

/** The query args one member of a union runs with: shared `select` merged with its own. */
type MemberArgsOf<TSchema extends AnySchema, TAlias extends string, TShared, TOn> = {
  select: TShared extends object
    ? TOn extends { select: infer TOwn }
      ? TShared & TOwn
      : TShared
    : TOn extends { select: infer TOwn }
      ? TOwn
      : undefined;
  join: TOn extends { join: infer TJoin } ? TJoin : undefined;
} extends infer TArgs
  ? TArgs extends QueryArgs<TableByAlias<TSchema, TAlias>, TSchema>
    ? TArgs
    : QueryArgs<TableByAlias<TSchema, TAlias>, TSchema>
  : never;

type OnEntryOf<TArgs, TAlias extends string> = TArgs extends { on: infer TOn }
  ? TAlias extends keyof TOn
    ? TOn[TAlias]
    : undefined
  : undefined;

type SharedSelectOf<TArgs> = TArgs extends { select: infer TSelect } ? TSelect : undefined;

/**
 * One row of a union result: a union over the members `on` did not exclude, each tagged with
 * its alias in `$$key` — which is what narrows it — and shaped by that member's own selection.
 */
export type UnionResultOf<TMembers extends AnyUnionMembers, TSchema extends AnySchema, TArgs> = {
  [A in keyof TMembers & string]: IsExcluded<A, TArgs extends { on: infer TOn } ? TOn : undefined> extends true
    ? never
    : Prettify<
        { $$key: A } & QueryResultOf<
          TableByAlias<TSchema, A>,
          TSchema,
          MemberArgsOf<TSchema, A, SharedSelectOf<TArgs>, OnEntryOf<TArgs, A>>
        >
      >;
}[keyof TMembers & string];

export type UnionJoinResultOf<
  TMembers extends AnyUnionMembers,
  TSchema extends AnySchema,
  TArgs,
  TType,
> = TType extends "has_many"
  ? UnionResultOf<TMembers, TSchema, TArgs>[]
  : UnionResultOf<TMembers, TSchema, TArgs> | null;

/** What the normalizer receives for a union level, before any type narrowing. */
export interface AnyUnionQuery {
  select?: Record<string, boolean | undefined> | null;
  where?: Record<string, unknown> | null;
  orderBy?: Record<string, "asc" | "desc" | undefined> | null;
  limit?: number | null;
  offset?: number | null;
  distinct?: boolean;
  on?: Record<string, boolean | AnyRelationQuery | undefined> | null;
}

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

/* -------------------------------------------------------------------------------------------
 * Global ids
 * ---------------------------------------------------------------------------------------- */

/**
 * The field a table's primary key is a single `guid()` column under, or `never`.
 *
 * Mirrors the runtime rule in `packages/dsqlbase/src/client/nodes.ts`. A composite key is
 * declared with `table.primaryKey((c) => [...])`, which sets no column-level flag, so such a
 * table yields `never` here exactly as it fails to become a node there.
 */
export type NodeKeyFieldOf<T extends AnyTable> = {
  [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { primaryKey: true; guid: true } ? K : never;
}[FieldNamesOf<T>];

/** The aliases of a schema that can be addressed by global id. */
export type NodeAliasesOf<TSchema extends AnySchema> = {
  [K in keyof TSchema["tables"] & string]: [NodeKeyFieldOf<TableByAlias<TSchema, K>>] extends [
    never,
  ]
    ? never
    : K;
}[keyof TSchema["tables"] & string];

/**
 * What to do with each member of a set of tables a single call may resolve to — the members
 * of a union, or every node a global id may name.
 *
 * `true` — or leaving the alias out — runs the member as it is; `false` excludes it, so it is
 * gone from the result union and refused at runtime. An object adds member-only arguments: a
 * `select`, a `where` AND-ed with whatever else filters it, and a `join` over its own relations.
 */
export type OnSelectionOf<TAliases extends string, TSchema extends AnySchema> = {
  [K in TAliases]?:
    | Pick<QueryArgs<TableByAlias<TSchema, K>, TSchema>, "select" | "where" | "join">
    | boolean;
};

/** The `on` map `$findByGlobalId` and `$listByGlobalId` take. */
export type GlobalIdOptionsOf<TSchema extends AnySchema> = OnSelectionOf<
  NodeAliasesOf<TSchema>,
  TSchema
>;

/** The query args one member of an `on` map resolves to. */
type NodeArgsOf<
  TSchema extends AnySchema,
  TAlias extends NodeAliasesOf<TSchema>,
  TOn,
> = TAlias extends keyof TOn
  ? TOn[TAlias] extends QueryArgs<TableByAlias<TSchema, TAlias>, TSchema>
    ? TOn[TAlias]
    : QueryArgs<TableByAlias<TSchema, TAlias>, TSchema>
  : QueryArgs<TableByAlias<TSchema, TAlias>, TSchema>;

/** Whether an `on` map excluded a member outright. */
type IsExcluded<TAlias extends string, TOn> = TAlias extends keyof TOn
  ? TOn[TAlias] extends false
    ? true
    : false
  : false;

/**
 * A resolved node row, tagged with the alias it came from.
 *
 * `$$key` rather than `$$meta.key`, because **TypeScript does not narrow a union on a nested
 * discriminant**: `record.$$meta.key === "authors"` compiles but narrows nothing, while
 * `record.$$key === "authors"` narrows. `$$key` has been a reserved field name since
 * [0004](../../../../../docs/decisions/0004-record-meta.md) for exactly this, and it carries
 * the same value as `$$meta.key`.
 *
 * It is added by the lookup methods, not by the resolver, so an ordinary `findOne` row is
 * unchanged — a single-table read has nothing to discriminate.
 */
type TaggedNodeOf<TSchema extends AnySchema, TAlias extends NodeAliasesOf<TSchema>, TOn> = Prettify<
  { $$key: TAlias } & QueryResultOf<
    TableByAlias<TSchema, TAlias>,
    TSchema,
    NodeArgsOf<TSchema, TAlias, TOn>
  >
>;

/**
 * The row a global id resolves to: a union over every node the schema declares, narrowed by
 * the caller's `on` map, discriminated by `$$key`.
 */
export type GlobalIdResultOf<TSchema extends AnySchema, TOn = undefined> =
  | {
      [K in NodeAliasesOf<TSchema>]: IsExcluded<K, TOn> extends true
        ? never
        : TaggedNodeOf<TSchema, K, TOn>;
    }[NodeAliasesOf<TSchema>]
  | null;

/**
 * As {@link GlobalIdResultOf}, with the node's key field forced into every selection.
 *
 * `$listByGlobalId` returns rows in the order the ids were given, which means matching each
 * row back to the id that asked for it — and the only thing that can do that is the key
 * itself. So it is always projected, even when `select` leaves it out.
 */
export type GlobalIdListResultOf<TSchema extends AnySchema, TOn = undefined> = {
  [K in NodeAliasesOf<TSchema>]: IsExcluded<K, TOn> extends true
    ? never
    : Prettify<
        { $$key: K } & QueryResultOf<
          TableByAlias<TSchema, K>,
          TSchema,
          NodeArgsOf<TSchema, K, TOn> extends { select: infer TSelect }
            ? Omit<NodeArgsOf<TSchema, K, TOn>, "select"> & {
                select: TSelect & Record<NodeKeyFieldOf<TableByAlias<TSchema, K>>, true>;
              }
            : NodeArgsOf<TSchema, K, TOn>
        >
      >;
}[NodeAliasesOf<TSchema>];
