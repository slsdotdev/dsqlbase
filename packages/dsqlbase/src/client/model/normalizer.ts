import { TypedObject } from "@dsqlbase/core/utils";
import { KEY_FIELD } from "@dsqlbase/core/definition";
import { decodeMemberId, getDynamicGuidBinding } from "../nodes.js";
import { GlobalIdError } from "../../schema/utils/global-id.js";
import {
  AnyColumn,
  AnyColumnGroup,
  AnyField,
  AnyTable,
  Column,
  ColumnGroup,
  CountOperationArgs,
  DefinitionSchema,
  DeleteOperationArgs,
  ExecutionContext,
  FieldMutation,
  FieldSelection,
  GroupSelection,
  InsertOperationArgs,
  KeysetBound,
  OperationMode,
  OperationRequest,
  Schema,
  SelectOperationArgs,
  sql,
  SQLNode,
  SQLValue,
  Union,
  UnionCountOperationArgs,
  UnionOrderKey,
  UnionSelectOperationArgs,
  UpdateOperationArgs,
} from "@dsqlbase/core";
import {
  AnyRelationQuery,
  AnyUnionQuery,
  CountArgs,
  CreateArgs,
  DeleteArgs,
  FieldSelectionOf,
  JoinExpressionOf,
  OrderByExpressionOf,
  PaginateArgs,
  QueryArgs,
  UpdateArgs,
  UpdateValuesOf,
} from "./base.js";
import {
  CursorKey,
  decodeCursor,
  InvalidCursorError,
  keysetSignature,
} from "../pagination/cursor.js";
import { rulesOf, WhereBuilder, WhereExpressionOf } from "./filters.js";

/** The page size when neither the call nor the client names one. */
export const DEFAULT_PAGE_SIZE = 100;

type OrderKey = {
  field: string;
  column: AnyColumn;
  direction: "asc" | "desc";
  /** Set on a page's keys only: whether the key can hold `NULL`, so its nulls must be placed. */
  nullable?: boolean;
};

const flip = (direction: "asc" | "desc"): "asc" | "desc" => (direction === "asc" ? "desc" : "asc");

/** What {@link shapePage} reads off a page plan, whichever kind of select produced it. */
export type PagePlan = {
  /** The total order, as the cursor signs it. */
  keys: CursorKey[];
  signature: string;
  take: number;
  bound: KeysetBound;
  cursor?: (string | null)[];
};

/** Everything a union's `paginate` needs besides the select itself. */
export type UnionPaginateRequest = {
  request: OperationRequest<UnionSelectOperationArgs, "many">;
  /** The same members and filters without the keyset — what a count of the same rows uses. */
  count: OperationRequest<UnionCountOperationArgs, "one">;
} & PagePlan;

/** Everything `paginate` needs besides the select itself. */
export type PaginateRequest = {
  request: OperationRequest<SelectOperationArgs, "many">;
  /** The caller's own filter, without the keyset — what a count of the same rows uses. */
  where?: SQLNode;
  /** The total order, as the cursor signs it: the caller's keys, then the primary key. */
  keys: CursorKey[];
  signature: string;
  /** The page size. The select reads one row more, to learn whether another page follows. */
  take: number;
  bound: KeysetBound;
  /** The key values of the cursor row, when the call passed a cursor. */
  cursor?: (string | null)[];
};

export class RequestNormalizer<TDefinition extends DefinitionSchema> implements TypedObject<
  Schema<TDefinition>
> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext;
  private readonly _where = new WhereBuilder();

  constructor(context: ExecutionContext) {
    this._ctx = context;
  }

  /** The columns a `return` names, or `undefined` — every column — when it names none. */
  private _getSelectionEntries<TTable extends AnyTable>(
    table: TTable,
    selection: FieldSelectionOf<TTable> | boolean | null | undefined
  ): FieldSelection[] | undefined {
    const entries: FieldSelection[] = [];

    if (!selection || typeof selection === "boolean") {
      return undefined;
    }

    for (const [fieldName, isSelected] of Object.entries(selection)) {
      if (isSelected) {
        const field = table.getColumn(fieldName);

        if (!field) {
          throw new Error(`Invalid field "${fieldName}" in selection for table "${table.name}".`);
        }

        entries.push(this._getFieldSelection(table, fieldName, field, isSelected));
      }
    }

    return entries.length > 0 ? entries : undefined;
  }

  /**
   * One selected field: a column takes `true`; a group takes `true` — every member — or a map
   * naming some, each a member column or a nested group read the same way.
   */
  private _getFieldSelection(
    table: AnyTable,
    path: string,
    field: AnyField,
    selected: unknown
  ): FieldSelection {
    if (field instanceof Column) {
      if (selected !== true) {
        throw new Error(
          `Invalid selection for column "${path}" of "${table.name}": a column takes true.`
        );
      }

      return [path.split(".").at(-1) as string, field];
    }

    return [
      path.split(".").at(-1) as string,
      field,
      this._getGroupSelection(table, path, field, selected),
    ];
  }

  private _getGroupSelection(
    table: AnyTable,
    path: string,
    group: AnyColumnGroup,
    selected: unknown
  ): GroupSelection | undefined {
    if (selected === true) {
      return undefined;
    }

    if (typeof selected !== "object" || selected === null || Array.isArray(selected)) {
      throw new Error(
        `Invalid selection for group "${path}" of "${table.name}": a group takes true or a ` +
          `map of its members.`
      );
    }

    const entries: GroupSelection = [];

    for (const [member, value] of Object.entries(selected)) {
      if (value === false || value === null || value === undefined) {
        continue;
      }

      const field = group.getColumn(member);

      if (!field) {
        throw new Error(
          `Invalid field "${path}.${member}" in selection for table "${table.name}".`
        );
      }

      entries.push(
        this._getFieldSelection(table, `${path}.${member}`, field, value) as GroupSelection[number]
      );
    }

    return entries;
  }

  /**
   * A read's `select`, split into the columns it names and the relations it names. A relation
   * takes `true` or a field map, and is read exactly as `join: { r: true }` or
   * `join: { r: { select: map } }`: it is merged into `join` here, so everything after this
   * sees one join form. The same relation in both is refused rather than merged.
   *
   * Which columns come back: those named; none when only relations are named (`[]`); every
   * column when nothing is named at all (`undefined`), as with no `select`.
   */
  private _getReadSelection<TTable extends AnyTable>(
    table: TTable,
    selection: Record<string, unknown> | null | undefined,
    join: Record<string, unknown> | null | undefined,
    columns: FieldSelection[] = []
  ): { select: FieldSelection[] | undefined; join: Record<string, unknown> } {
    // Selected relations first, so a result's keys follow the call as written.
    const merged: Record<string, unknown> = {};

    for (const [fieldName, value] of Object.entries(selection ?? {})) {
      if (value === false || value === null || value === undefined) {
        continue;
      }

      const column = table.getColumn(fieldName);

      if (column && (value === true || column instanceof ColumnGroup)) {
        if (!columns.some(([name]) => name === fieldName)) {
          columns.push(this._getFieldSelection(table, fieldName, column, value));
        }

        continue;
      }

      if (column || !this._isRelation(table, fieldName)) {
        throw new Error(`Invalid field "${fieldName}" in selection for table "${table.name}".`);
      }

      const joined = join?.[fieldName];

      if (joined !== undefined && joined !== null && joined !== false) {
        throw new Error(
          `Relation "${fieldName}" appears in both select and join on "${table.name}"; ` +
            `name it in one of them.`
        );
      }

      merged[fieldName] = value === true ? true : { select: value };
    }

    const hasRelation = Object.keys(merged).length > 0;

    for (const [fieldName, entry] of Object.entries(join ?? {})) {
      // A selected relation is only ever beside a falsy join entry here, which it outranks.
      if (!(fieldName in merged)) {
        merged[fieldName] = entry;
      }
    }

    return {
      select: columns.length > 0 ? columns : hasRelation ? [] : undefined,
      join: merged,
    };
  }

  private _isRelation(table: AnyTable, fieldName: string): boolean {
    const { schema } = this._ctx;

    return (
      schema.hasRelations(table.name) && Object.hasOwn(schema.getRelations(table.name), fieldName)
    );
  }

  /** `orderBy` as resolved keys, in the order the caller wrote them. */
  private _getOrderKeys<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): OrderKey[] {
    const keys: OrderKey[] = [];

    for (const [field, direction] of Object.entries(orderBy ?? {})) {
      const column = table.getColumn(field);

      if (!(column instanceof Column)) {
        throw new Error(`Invalid field "${field}" in orderBy for table "${table.name}".`);
      }

      if (!rulesOf(column).orderable) {
        throw new Error(
          `Cannot order by the ${column.runtimeType} column "${field}" of "${table.name}".`
        );
      }

      if (direction === "asc" || direction === "desc") {
        keys.push({ field, column, direction });
      }
    }

    return keys;
  }

  /**
   * `ORDER BY` terms. A nullable page key states its null placement — Postgres's own default,
   * last ascending and first descending — so the order never depends on a server setting and
   * always agrees with the keyset predicate. Flipping a direction flips the placement with it,
   * which is what makes a page read backwards the exact reverse of one read forwards.
   */
  private _renderOrderKeys(keys: OrderKey[]): SQLNode[] {
    return keys.map(({ column, direction, nullable }) => {
      if (!nullable) {
        return direction === "asc" ? sql`${column} ASC` : sql`${column} DESC`;
      }

      return direction === "asc" ? sql`${column} ASC NULLS LAST` : sql`${column} DESC NULLS FIRST`;
    });
  }

  private _getOrderByEntries<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): SQLNode[] | undefined {
    if (!orderBy) {
      return undefined;
    }

    return this._renderOrderKeys(this._getOrderKeys(table, orderBy));
  }

  /**
   * The total order a page is read under: the caller's keys, then every primary-key column
   * they did not already name, so no two rows ever tie. An appended key follows the direction
   * of the last one the caller wrote — `asc` when they wrote none.
   */
  private _getKeysetOrder<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): OrderKey[] {
    if (table.primaryKey.length === 0) {
      throw new Error(
        `Cannot paginate "${table.name}": it has no primary key to break ties between rows.`
      );
    }

    const keys = this._getOrderKeys(table, orderBy);
    const direction = keys.at(-1)?.direction ?? "asc";

    const fields = new Map(table.getColumnEntries().map(([field, column]) => [column, field]));

    for (const column of table.primaryKey) {
      if (!keys.some((key) => key.column === column)) {
        keys.push({ field: fields.get(column) as string, column, direction });
      }
    }

    // A primary-key column cannot hold NULL, whether or not it was also marked notNull.
    return keys.map((key) => ({
      ...key,
      nullable: !key.column.notNull && !table.primaryKey.includes(key.column),
    }));
  }

  private _getPageSize(limit: number | undefined): number {
    const { defaultLimit = DEFAULT_PAGE_SIZE, maxLimit } = this._ctx.pagination ?? {};
    const size = limit ?? defaultLimit;

    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`A page size must be a positive integer (got ${String(size)}).`);
    }

    if (maxLimit !== undefined && size > maxLimit) {
      throw new Error(`A page size of ${size} exceeds this client's maxLimit of ${maxLimit}.`);
    }

    return size;
  }

  private _getJoinEntries<TTable extends AnyTable>(
    table: TTable,
    join: JoinExpressionOf<TTable, this["__type"]> | null | undefined
  ): [string, SelectOperationArgs | UnionSelectOperationArgs][] | undefined {
    const entries: [string, SelectOperationArgs | UnionSelectOperationArgs][] = [];

    if (!join || Object.keys(join).length === 0) {
      return undefined;
    }

    for (const [fieldName, query] of Object.entries(join as Record<string, AnyRelationQuery>)) {
      if (query === null || query === undefined || (typeof query === "boolean" && !query)) {
        continue;
      }

      const targetTable = this._ctx.schema.getRelationTarget(table.name, fieldName);

      if (!targetTable) {
        throw new Error(
          `Relation "${fieldName}" in table "${table.name}" does not have a valid target table.`
        );
      }

      if (targetTable instanceof Union) {
        entries.push([
          fieldName,
          this._getUnionArgs(targetTable, query === true ? {} : (query as AnyUnionQuery)),
        ]);
        continue;
      }

      const params = this._getSelectArgs(targetTable, query === true ? {} : query);
      entries.push([fieldName, params]);
    }

    return entries;
  }

  /**
   * The arguments of a select over a union, one entry per member that runs.
   *
   * The shared `select` / `where` apply to every member, written against that member's own
   * columns; `on.<alias>` then adds to them — its `select` is merged in, its `where` AND-ed
   * with the shared one, its `join` walks the member's own relations — or, as `false`, drops
   * the member entirely. Omitted, a member runs with the shared arguments alone.
   */
  private _getUnionArgs(union: Union, args: AnyUnionQuery): UnionSelectOperationArgs {
    if (args.distinct) {
      throw new Error(`\`distinct\` is not supported on union "${union.alias}".`);
    }

    const on = (args.on ?? {}) as Record<string, unknown>;

    for (const alias of Object.keys(on)) {
      if (!union.hasMember(alias)) {
        throw new Error(
          `"${alias}" in \`on\` is not a member of union "${union.alias}" ` +
            `(members: ${union.memberAliases.join(", ")}).`
        );
      }
    }

    const sharedSelect = Object.entries(args.select ?? {})
      .filter(([, selected]) => selected)
      .map(([field]) => field);

    for (const field of sharedSelect) {
      if (!union.isShared(field)) {
        throw new Error(
          `Invalid field "${field}" in selection for union "${union.alias}": only fields every ` +
            `member shares select across a union. Select it for one member through \`on\`.`
        );
      }
    }

    this._where.assertShared(union, args.where as Record<string, unknown> | undefined);

    const members: [string, SelectOperationArgs][] = [];

    for (const alias of union.memberAliases) {
      const entry = on[alias];

      if (entry === false) {
        continue;
      }

      const sharedWhere = args.where
        ? this._where.foldKey(union, args.where as Record<string, unknown>, alias)
        : undefined;

      // A `$$key` condition this member can never satisfy: no branch at all.
      if (sharedWhere === false) {
        continue;
      }

      const member = union.getMember(alias);
      const own = (typeof entry === "object" && entry !== null ? entry : {}) as QueryArgs<
        AnyTable,
        this["__type"]
      >;

      const shared: FieldSelection[] = sharedSelect.map((field) => [
        field,
        union.getMemberColumn(alias, field),
      ]);
      // The member's own select adds to the shared one; a relation in it becomes a member join.
      const selection = this._getReadSelection(
        member,
        own.select as Record<string, unknown> | undefined,
        own.join as Record<string, unknown> | undefined,
        shared
      );

      const where = [
        this._where.build(member, sharedWhere as WhereExpressionOf<AnyTable> | undefined),
        this._where.build(member, own.where),
      ].filter((node): node is SQLNode => node !== undefined);

      members.push([
        alias,
        {
          select: selection.select,
          where: where.length > 0 ? where : undefined,
          join: this._getJoinEntries(
            member,
            selection.join as JoinExpressionOf<AnyTable, this["__type"]>
          ),
        },
      ]);
    }

    return {
      members,
      orderBy: this._getUnionOrderKeys(union, args.orderBy),
      limit: args.limit ?? undefined,
      offset: args.offset ?? undefined,
    };
  }

  private _getUnionOrderKeys(
    union: Union,
    orderBy: Record<string, unknown> | null | undefined
  ): UnionOrderKey[] | undefined {
    if (!orderBy) {
      return undefined;
    }

    const keys: UnionOrderKey[] = [];

    for (const [field, direction] of Object.entries(orderBy)) {
      if (field !== KEY_FIELD && !union.isShared(field)) {
        throw new Error(
          `Invalid field "${field}" in orderBy for union "${union.alias}": only fields every ` +
            `member shares, and ${KEY_FIELD}, order across a union.`
        );
      }

      if (field !== KEY_FIELD) {
        const column = union.getMemberColumn(union.memberAliases[0] as string, field);

        if (!rulesOf(column).orderable) {
          throw new Error(
            `Cannot order by the ${column.runtimeType} field "${field}" of union "${union.alias}".`
          );
        }
      }

      if (direction === "asc" || direction === "desc") {
        keys.push({ field, direction });
      }
    }

    return keys;
  }

  private _getMutationEntries<TTable extends AnyTable>(
    table: TTable,
    values: UpdateValuesOf<TTable>
  ): FieldMutation[] {
    const entries: FieldMutation[] = [];

    for (const [fieldName, value] of Object.entries(values as Record<string, SQLValue>)) {
      const column = table.getColumn(fieldName);

      if (!(column instanceof Column)) {
        throw new Error(`Invalid field "${fieldName}" in update values for table "${table.name}".`);
      }

      // Read-only columns are dropped rather than refused: the types already exclude them, so a
      // value here arrived through an untyped spread, and whatever owns the column wins anyway.
      if (column.readOnly) {
        continue;
      }

      entries.push([fieldName, value]);
    }

    return this._fillDiscriminators(table, values as Record<string, unknown>, entries);
  }

  /**
   * A polymorphic id written as a global id also says which member it names — so it fills the
   * discriminator when the caller left it out, and must agree with it when they did not. A raw
   * uuid says nothing and leaves the discriminator alone.
   */
  private _fillDiscriminators<TTable extends AnyTable>(
    table: TTable,
    values: Record<string, unknown>,
    entries: FieldMutation[]
  ): FieldMutation[] {
    for (const [fieldName, value] of Object.entries(values)) {
      const binding = getDynamicGuidBinding(table.getColumn(fieldName) as AnyColumn);
      const member = binding ? decodeMemberId(value, binding.members) : undefined;

      if (!binding || !member) {
        continue;
      }

      const given = values[binding.discriminatorField];

      if (given === undefined) {
        entries.push([binding.discriminatorField, member.key]);
        continue;
      }

      if (given !== member.key) {
        throw new GlobalIdError(
          "key_mismatch",
          `"${fieldName}" is a global id for "${member.key}", but "${binding.discriminatorField}" ` +
            `says "${String(given)}".`
        );
      }
    }

    return entries;
  }

  /** `distinct` compares whole rows, so every column it reads needs an equality operator. */
  private _assertDistinct(table: AnyTable, select: FieldSelection[] | undefined): void {
    // Every column the read projects is compared, a group's included — a nullable group
    // projects all of its columns to tell whether it is present.
    const fields: [string, unknown][] = select
      ? select.flatMap(([field, column, members]): [string, unknown][] =>
          column instanceof ColumnGroup
            ? column.reader(members).columns.map((leaf) => [`${field} (${leaf.name})`, leaf])
            : [[field, column]]
        )
      : table.getLeafEntries().map(([path, column]) => [path.join("."), column]);

    for (const [field, column] of fields) {
      if (column instanceof Column && !rulesOf(column).distinct) {
        throw new Error(
          `\`distinct\` cannot compare the ${column.runtimeType} column "${field}" of ` +
            `"${table.name}"; leave it out of the selection.`
        );
      }
    }
  }

  private _getSelectArgs<TTable extends AnyTable>(
    table: TTable,
    args: QueryArgs<TTable, this["__type"]>
  ): SelectOperationArgs {
    const selection = this._getReadSelection(
      table,
      args.select as Record<string, unknown> | undefined,
      args.join as Record<string, unknown> | undefined
    );
    const where = this._where.build(table, args.where);
    const join = this._getJoinEntries(
      table,
      selection.join as JoinExpressionOf<TTable, this["__type"]>
    );
    const orderBy = this._getOrderByEntries(table, args.orderBy);

    if (args.distinct) {
      this._assertDistinct(table, selection.select);
    }

    return {
      select: selection.select,
      where,
      join,
      orderBy,
      distinct: args.distinct,
      limit: args.limit,
      offset: args.offset,
    };
  }

  public normalizeSelect<
    TTable extends AnyTable,
    TArgs extends QueryArgs<TTable, this["__type"]>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<SelectOperationArgs, TMode> {
    const request = this._getSelectArgs(table, args);

    // `findOne` requires a where by type; one that selects nothing in particular is refused.
    if (mode === "one") {
      request.where = this._where.buildRequired(table, args.where, "findOne");
    }

    return { mode, args: request };
  }

  /**
   * A page read: the select to run, plus everything needed to turn its rows into a page.
   *
   * The keyset predicate is appended to the caller's `where` as a second condition, so the
   * seam in core renders the tenant predicate, then the caller's filter, then the keyset. The
   * caller's filter alone is kept apart as `where`, for a count over the same rows.
   */
  public normalizePaginate<
    TTable extends AnyTable,
    TArgs extends PaginateArgs<TTable, this["__type"]>,
  >(table: TTable, args: TArgs): PaginateRequest {
    const { after, before } = args;

    if (after != null && before != null) {
      throw new Error("Pass either after or before, not both.");
    }

    const take = this._getPageSize(args.limit);
    const keys = this._getKeysetOrder(table, args.orderBy);
    const signature = keysetSignature(table.alias, keys);
    const bound = before != null ? "before" : "after";
    const token = after ?? before ?? undefined;

    let cursor: (string | null)[] | undefined;

    if (token !== undefined) {
      cursor = decodeCursor(token, signature, keys.length);

      if (cursor.some((value, index) => value === null && !keys[index].nullable)) {
        throw new InvalidCursorError(
          "format",
          `"${token}" carries a null for a key that cannot hold one.`
        );
      }
    }

    const base = this._getSelectArgs(table, { select: args.select, join: args.join });
    const where = this._where.build(table, args.where);
    const keyset = cursor
      ? sql.keyset(
          keys.map(({ column, direction, nullable }) => ({ node: column, direction, nullable })),
          cursor,
          bound
        )
      : undefined;

    // A page before the cursor is read backwards — every direction flipped — and put back in
    // order once it is resolved, so the rows nearest the cursor are the ones kept.
    const order =
      bound === "before" ? keys.map((key) => ({ ...key, direction: flip(key.direction) })) : keys;

    return {
      request: {
        mode: "many",
        args: {
          ...base,
          where: [where, keyset].filter((node): node is SQLNode => node !== undefined),
          orderBy: this._renderOrderKeys(order),
          keys: keys.map(({ column }) => column),
          limit: take + 1,
        },
      },
      where,
      keys: keys.map(({ field, direction }) => ({ field, direction })),
      signature,
      take,
      bound,
      cursor,
    };
  }

  /**
   * A top-level select over a union. `findOne` needs a `where`, exactly as on a table: a
   * union row is only "the" row when something names it.
   */
  public normalizeUnionSelect<TMode extends OperationMode>(
    union: Union,
    args: AnyUnionQuery,
    mode: TMode
  ): OperationRequest<UnionSelectOperationArgs, TMode> {
    if (mode === "one" && Object.keys(args.where ?? {}).length === 0) {
      throw new Error(
        `findOne on union "${union.alias}" needs a where that names the row it reads; an ` +
          `empty one would match every row of every member.`
      );
    }

    return { mode, args: this._getUnionArgs(union, args) };
  }

  /**
   * A page read over a union, under a total order built the way core builds it: the caller's
   * keys, then `$$key` unless they named it, then each primary-key column by position
   * (`$$pk<n>`), the appended keys following the caller's last direction. The cursor signs
   * that whole list against the union's alias, so a table's cursor never reads a union's page.
   */
  public normalizeUnionPaginate(
    union: Union,
    args: AnyUnionQuery & { after?: string | null; before?: string | null }
  ): UnionPaginateRequest {
    const { after, before } = args;

    if (after != null && before != null) {
      throw new Error("Pass either after or before, not both.");
    }

    const tiebreakers = union.tiebreakers;

    if (tiebreakers === 0) {
      throw new Error(
        `Cannot page union "${union.alias}": its members' primary keys differ in arity or type, ` +
          `so nothing can break a tie between two members' rows.`
      );
    }

    const take = this._getPageSize(args.limit ?? undefined);
    const orderBy = (this._getUnionOrderKeys(union, args.orderBy) ?? []).map((key) => ({
      ...key,
      nullable:
        key.field !== KEY_FIELD &&
        union.memberAliases.some((alias) => {
          const column = union.getMemberColumn(alias, key.field);
          return !column.notNull && !union.getMember(alias).primaryKey.includes(column);
        }),
    }));

    const tiebreak = orderBy.at(-1)?.direction ?? "asc";
    const keys: (CursorKey & { nullable?: boolean })[] = [
      ...orderBy,
      ...(orderBy.some((key) => key.field === KEY_FIELD)
        ? []
        : [{ field: KEY_FIELD, direction: tiebreak }]),
      ...Array.from({ length: tiebreakers }, (_, index) => ({
        field: `$$pk${index}`,
        direction: tiebreak,
      })),
    ];

    const signature = keysetSignature(union.alias, keys);
    const bound = before != null ? "before" : "after";
    const token = after ?? before ?? undefined;

    let cursor: (string | null)[] | undefined;

    if (token !== undefined) {
      cursor = decodeCursor(token, signature, keys.length);

      if (cursor.some((value, index) => value === null && !keys[index].nullable)) {
        throw new InvalidCursorError(
          "format",
          `"${token}" carries a null for a key that cannot hold one.`
        );
      }
    }

    const base = this._getUnionArgs(union, { select: args.select, where: args.where, on: args.on });

    return {
      request: {
        mode: "many",
        args: {
          ...base,
          orderBy,
          tiebreak,
          keys: true,
          keyset: cursor ? { values: cursor, bound } : undefined,
          limit: take + 1,
        },
      },
      count: {
        mode: "one",
        args: { members: base.members.map(([alias, member]) => [alias, { where: member.where }]) },
      },
      keys: keys.map(({ field, direction }) => ({ field, direction })),
      signature,
      take,
      bound,
      cursor,
    };
  }

  /** A count over the rows a union's members select. */
  public normalizeUnionCount(
    union: Union,
    args: Pick<AnyUnionQuery, "where"> = {}
  ): OperationRequest<UnionCountOperationArgs, "one"> {
    const { members } = this._getUnionArgs(union, { where: args.where });

    return {
      mode: "one",
      args: { members: members.map(([alias, member]) => [alias, { where: member.where }]) },
    };
  }

  /** A count over the rows `where` selects. */
  public normalizeCount<TTable extends AnyTable>(
    table: TTable,
    args: CountArgs<TTable> = {}
  ): OperationRequest<CountOperationArgs, "one"> {
    return {
      mode: "one",
      args: { where: this._where.build(table, args.where) },
    };
  }

  public normalizeInsert<
    TTable extends AnyTable,
    TArgs extends CreateArgs<TTable>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<InsertOperationArgs, TMode> {
    const values = this._getMutationEntries(table, args.data);
    const returning = this._getSelectionEntries(table, args.return);

    return {
      mode,
      args: {
        data: [values],
        return: returning,
      },
    };
  }

  public normalizeUpdate<
    TTable extends AnyTable,
    TArgs extends UpdateArgs<TTable>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<UpdateOperationArgs, TMode> {
    const values = this._getMutationEntries(table, args.set);
    const where = this._where.buildRequired(table, args.where, "update");
    const returning = this._getSelectionEntries(table, args.return);

    return {
      mode,
      args: {
        set: values,
        where,
        return: returning,
      },
    };
  }

  public normalizeDelete<
    TTable extends AnyTable,
    TArgs extends DeleteArgs<TTable>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<DeleteOperationArgs, TMode> {
    const where = this._where.buildRequired(table, args.where, "delete");
    const returning = this._getSelectionEntries(table, args.return);

    return {
      mode,
      args: {
        where,
        return: returning,
      },
    };
  }
}
