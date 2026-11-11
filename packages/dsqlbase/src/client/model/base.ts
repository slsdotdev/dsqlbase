import {
  AnyColumnDefinition,
  AnyNamespaceDefinition,
  AnyUnionDefinition,
  TableDefinition,
} from "@dsqlbase/core/definition";
import {
  AnySchema,
  AnyTable,
  AnyUnion,
  SchemaTableRelations,
  Table,
  TableByAlias,
} from "@dsqlbase/core/runtime";
import { Prettify, WithMeta } from "@dsqlbase/core/utils";
import { FilterOf, WhereExpressionOf } from "./filters.js";

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

/** The columns a selection names as `true` — never its relations. */
export type SelectedFieldsOf<
  TTable extends AnyTable,
  TSelection extends FieldSelectionOf<TTable>,
> = {
  [K in keyof TSelection]: K extends FieldNamesOf<TTable>
    ? TSelection[K] extends true
      ? K
      : never
    : never;
}[keyof TSelection];

/**
 * Every key a selection names: a column as `true`, a relation as `true` or a field map. None
 * means every column, as with no selection at all.
 */
type NamedKeysOf<TSelection> = {
  [K in keyof TSelection]-?: TSelection[K] extends true | object ? K : never;
}[keyof TSelection];

/**
 * The relation fields a table declares. A table with no `relations()` block reads its
 * relations as a bare record, whose keys are `string` — every key, columns included — so that
 * case is none.
 */
type DeclaredRelationNamesOf<T extends AnyTable> =
  string extends RelationFieldNamesOf<T> ? never : RelationFieldNamesOf<T>;

/** The relations a selection names, as `true` or a field map. */
type SelectedRelationsOf<T extends AnyTable, TSelection> = NamedKeysOf<TSelection> &
  DeclaredRelationNamesOf<T>;

/**
 * Refuses a call naming one relation in both `select` and `join`: `join` is typed `never` for
 * that key. Checked at the level the call is made; deeper levels are refused at runtime.
 */
export type NoSelectJoinOverlap<TArgs> = TArgs extends {
  select?: infer TSelect;
  join?: infer TJoin;
}
  ? [OverlapOf<TSelect, TJoin>] extends [never]
    ? unknown
    : { join: Record<OverlapOf<TSelect, TJoin>, never> }
  : unknown;

type OverlapOf<TSelect, TJoin> = Extract<NamedKeysOf<TSelect>, NamedKeysOf<TJoin>> & string;

export type ReturningResultOf<
  T extends AnyTable,
  TArgs,
  TAlias extends string = string,
> = TArgs extends {
  return?: infer R;
}
  ? R extends FieldSelectionOf<T>
    ? Prettify<
        ([SelectedFieldsOf<T, R>] extends [never]
          ? { [K in FieldNamesOf<T>]: ValueTypeOf<ColumnTypeOf<T, K>> }
          : {
              [K in SelectedFieldsOf<T, R>]: K extends FieldNamesOf<T>
                ? ValueTypeOf<ColumnTypeOf<T, K>>
                : never;
            }) & {
          $$meta: RecordMetaOf<T, TAlias>;
        }
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

export type UpdateArgs<TTable extends AnyTable> = Prettify<{
  set: UpdateValuesOf<TTable>;
  where: WhereExpressionOf<TTable>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export type DeleteArgs<TTable extends AnyTable> = Prettify<{
  where: WhereExpressionOf<TTable>;
  return?: FieldSelectionOf<TTable> | boolean | null | undefined;
}>;

export type FindOneArgs<TTable extends AnyTable, TSchema extends AnySchema> = {
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
} & Pick<QueryArgs<TTable, TSchema>, "select" | "join">;

export type PaginateArgs<TTable extends AnyTable, TSchema extends AnySchema> = {
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
} & Pick<QueryArgs<TTable, TSchema>, "select" | "where" | "orderBy" | "join">;

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

export type CountArgs<TTable extends AnyTable> = {
  where?: WhereExpressionOf<TTable>;
};

export type SelectionResultOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends QueryArgs<TTable, TSchema>,
> =
  // `object`, not `FieldSelectionOf`: a select naming only relations shares no key with the
  // column map, so it would not extend it.
  TArgs["select"] extends object
    ? [NamedKeysOf<TArgs["select"]>] extends [never]
      ? { [K in FieldNamesOf<TTable>]: ValueTypeOf<ColumnTypeOf<TTable, K>> }
      : {
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

/** One joined field of a result: relation `K` read with join entry `TEntry`. */
type JoinFieldResultOf<TTable extends AnyTable, TSchema extends AnySchema, K, TEntry> =
  K extends RelationFieldNamesOf<TTable>
    ? RelationTargetOf<TTable, K> extends TableDefinition<
        infer TName,
        infer TCols,
        infer TNamespace
      >
      ? TEntry extends QueryArgs<
          Table<TName, TCols, TNamespace, SchemaTableRelations<TSchema, TName>>,
          TSchema
        >
        ? RelationJoinResultOf<
            TTable,
            TSchema,
            TEntry,
            K,
            TName,
            TCols,
            TNamespace,
            DeclaredMetaOf<RelationTargetOf<TTable, K>>
          >
        : TEntry extends boolean
          ? TEntry extends true
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
      : RelationTargetOf<TTable, K> extends AnyUnionDefinition
        ? UnionJoinResultOf<
            RelationTargetOf<TTable, K>,
            TSchema,
            TEntry extends UnionQueryArgs<RelationTargetOf<TTable, K>, TSchema> ? TEntry : object,
            RelationTypeOf<TTable, K>
          >
        : never
    : never;

/** The relations named in `select`, each shaped as the `join` entry it is read as. */
type SelectedRelationsResultOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TSelection,
> = Prettify<{
  [K in SelectedRelationsOf<TTable, TSelection>]: JoinFieldResultOf<
    TTable,
    TSchema,
    K,
    TSelection[K] extends true ? true : { select: TSelection[K] }
  >;
}>;

export type QueryResultOf<
  TTable extends AnyTable,
  TSchema extends AnySchema,
  TArgs extends QueryArgs<TTable, TSchema>,
> = Prettify<
  SelectionResultOf<TTable, TSchema, TArgs> & {
    $$meta: RecordMetaOf<TTable, AliasOf<TSchema, TTable>>;
  } & SelectedRelationsResultOf<TTable, TSchema, TArgs["select"]> & {
      [K in NamedKeysOf<TArgs["join"]>]: JoinFieldResultOf<TTable, TSchema, K, TArgs["join"][K]>;
    }
>;

/* -------------------------------------------------------------------------------------------
 * Unions
 * ---------------------------------------------------------------------------------------- */

/** The fields a union declares — the only ones that select, filter and order across it. */
export type UnionFieldsOf<TUnion extends AnyUnion> = keyof TUnion["__type"]["columns"] & string;

/** The member aliases of a union. */
type MemberAliasesOf<TUnion extends AnyUnion> = keyof TUnion["__type"]["members"] & string;

/**
 * The relations every member of a union has — those declared on the union itself, which each
 * member has from its own columns. They join across the union, through `join` or `select`.
 */
export type UnionRelationNamesOf<TUnion extends AnyUnion, TSchema extends AnySchema> = {
  [A in MemberAliasesOf<TUnion>]: RelationFieldNamesOf<TableByAlias<TSchema, A>>;
}[MemberAliasesOf<TUnion>] extends infer TNames
  ? TNames extends string
    ? false extends {
        [A in MemberAliasesOf<TUnion>]: TNames extends RelationFieldNamesOf<
          TableByAlias<TSchema, A>
        >
          ? true
          : false;
      }[MemberAliasesOf<TUnion>]
      ? never
      : TNames
    : never
  : never;

/** A `join` across a union: a relation of every member, read the same way from each. */
export type UnionJoinExpressionOf<TUnion extends AnyUnion, TSchema extends AnySchema> = {
  [K in UnionRelationNamesOf<TUnion, TSchema>]?:
    | {
        [A in MemberAliasesOf<TUnion>]: K extends RelationFieldNamesOf<TableByAlias<TSchema, A>>
          ? RelationQueryOf<TableByAlias<TSchema, A>, TSchema, K>
          : never;
      }[MemberAliasesOf<TUnion>]
    | boolean
    | null
    | undefined;
};

/** The value a shared field holds, as the union declares it. */
type SharedValueOf<TUnion extends AnyUnion, K extends UnionFieldsOf<TUnion>> = ValueTypeOf<
  TUnion["__type"]["columns"][K]["__type"]
>;

/** The runtime type a shared field has, as the union declares it. */
type SharedRuntimeTypeOf<
  TUnion extends AnyUnion,
  K extends UnionFieldsOf<TUnion>,
> = TUnion["__type"]["columns"][K]["__type"]["runtimeType"];

/** The shared fields of a union that can be ordered by. */
type OrderableUnionFieldsOf<TUnion extends AnyUnion> = {
  [K in UnionFieldsOf<TUnion>]: IsOrderable<SharedRuntimeTypeOf<TUnion, K>> extends true
    ? K
    : never;
}[UnionFieldsOf<TUnion>];

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
export type UnionWhereExpressionOf<TUnion extends AnyUnion> = {
  [K in UnionFieldsOf<TUnion>]?: FilterOf<SharedRuntimeTypeOf<TUnion, K>, SharedValueOf<TUnion, K>>;
} & {
  $$key?: KeyFilterOf<MemberAliasesOf<TUnion>>;
  and?: UnionWhereExpressionOf<TUnion>[];
  or?: UnionWhereExpressionOf<TUnion>[];
  not?: UnionWhereExpressionOf<TUnion>;
};

/** The query args one member of a union runs with: shared `select` / `join` merged with its own. */
type MemberArgsOf<TSchema extends AnySchema, TAlias extends string, TShared, TOn, TSharedJoin> = {
  select: TShared extends object
    ? TOn extends { select: infer TOwn }
      ? TShared & TOwn
      : TShared
    : TOn extends { select: infer TOwn }
      ? TOwn
      : undefined;
  join: TSharedJoin extends object
    ? TOn extends { join: infer TJoin }
      ? TSharedJoin & TJoin
      : TSharedJoin
    : TOn extends { join: infer TJoin }
      ? TJoin
      : undefined;
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

type SharedJoinOf<TArgs> = TArgs extends { join: infer TJoin } ? TJoin : undefined;

/**
 * One row of a union result: a union over the members `on` did not exclude, each tagged with
 * its alias in `$$key` — which is what narrows it — and shaped by that member's own selection.
 */
export type UnionResultOf<TUnion extends AnyUnion, TSchema extends AnySchema, TArgs> = Prettify<
  {
    [A in MemberAliasesOf<TUnion>]: IsExcluded<
      A,
      TArgs extends { on: infer TOn } ? TOn : undefined
    > extends true
      ? never
      : Prettify<
          { $$key: A } & QueryResultOf<
            TableByAlias<TSchema, A>,
            TSchema,
            MemberArgsOf<
              TSchema,
              A,
              SharedSelectOf<TArgs>,
              OnEntryOf<TArgs, A>,
              SharedJoinOf<TArgs>
            >
          >
        >;
  }[MemberAliasesOf<TUnion>]
>;

export type UnionJoinResultOf<
  TUnion extends AnyUnion,
  TSchema extends AnySchema,
  TArgs,
  TType,
> = TType extends "has_many"
  ? UnionResultOf<TUnion, TSchema, TArgs>[]
  : UnionResultOf<TUnion, TSchema, TArgs> | null;

/** The members of a union definition, as a record of member alias → table definition. */
export type UnionMembersOf<TUnion> = TUnion extends AnyUnion ? TUnion["members"] : never;

/** A union's `findOne`: like `findMany`, but a `where` must name the row. */
export type UnionFindOneArgs<TUnion extends AnyUnion, TSchema extends AnySchema> = {
  where: UnionWhereExpressionOf<TUnion>;
} & Pick<UnionQueryArgs<TUnion, TSchema>, "select" | "join" | "orderBy" | "on">;

/** A union's `paginate` — the table form, with the union's shared-field arguments and `on`. */
export type UnionPaginateArgs<TUnion extends AnyUnion, TSchema extends AnySchema> = {
  /** The number of records on the page, under the client's `pagination` limits. */
  limit?: number;
  /** Read the page that follows this cursor, taken from this union under the same `orderBy`. */
  after?: string | null;
  /** Read the page that precedes this cursor. Never together with `after`. */
  before?: string | null;
  /** Also count every record `where` selects, across every member, as `totalCount`. */
  count?: boolean;
} & Pick<UnionQueryArgs<TUnion, TSchema>, "select" | "join" | "where" | "orderBy" | "on">;

/** One record of a union page: each member's row, its `$$meta` also carrying its cursor. */
export type UnionPageItemOf<TUnion extends AnyUnion, TSchema extends AnySchema, TArgs> =
  UnionResultOf<TUnion, TSchema, TArgs> extends infer TRow
    ? TRow extends { $$meta: infer TMeta }
      ? Prettify<Omit<TRow, "$$meta"> & { $$meta: Prettify<TMeta & { cursor: string }> }>
      : never
    : never;

export type UnionPageOf<
  TUnion extends AnyUnion,
  TSchema extends AnySchema,
  TArgs extends UnionPaginateArgs<TUnion, TSchema>,
> = Prettify<
  {
    items: UnionPageItemOf<TUnion, TSchema, TArgs>[];
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  } & TotalCountOf<TArgs>
>;

export type UnionCountArgs<TUnion extends AnyUnion> = {
  where?: UnionWhereExpressionOf<TUnion>;
};

/** What the normalizer receives for a union level, before any type narrowing. */
export type AnyUnionQuery = {
  select?: Record<string, boolean | undefined> | null;
  where?: Record<string, unknown> | null;
  join?: Record<string, unknown> | null;
  orderBy?: Record<string, "asc" | "desc" | undefined> | null;
  limit?: number | null;
  offset?: number | null;
  distinct?: boolean;
  on?: Record<string, boolean | AnyRelationQuery | undefined> | null;
};

export type AnyRelationQuery =
  | RelationQueryOf<AnyTable, AnySchema, RelationFieldNamesOf<AnyTable>>
  | boolean;

/* -------------------------------------------------------------------------------------------
 * Global ids
 * ---------------------------------------------------------------------------------------- */

/**
 * The aliases of a schema that can be addressed by global id: every table.
 *
 * At runtime a table is addressable when it has a unique key — a primary key of any arity, a
 * unique column, constraint or index (`packages/dsqlbase/src/client/nodes.ts`). Composite keys,
 * constraints and indexes leave no trace in a table's column types, so the types cannot tell;
 * a table with no unique key at all is listed here and refused at runtime.
 */
export type NodeAliasesOf<TSchema extends AnySchema> = keyof TSchema["tables"] & string;

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
type TaggedNodeOf<TSchema extends AnySchema, TAlias extends NodeAliasesOf<TSchema>> = Prettify<
  { $$key: TAlias } & QueryResultOf<
    TableByAlias<TSchema, TAlias>,
    TSchema,
    QueryArgs<TableByAlias<TSchema, TAlias>, TSchema>
  >
>;

/**
 * The row a global id resolves to, with every column: a union over every node the schema
 * declares, discriminated by `$$key`, or `null` when the row no longer exists.
 */
export type GlobalIdResultOf<TSchema extends AnySchema> =
  | { [K in NodeAliasesOf<TSchema>]: TaggedNodeOf<TSchema, K> }[NodeAliasesOf<TSchema>]
  | null;
