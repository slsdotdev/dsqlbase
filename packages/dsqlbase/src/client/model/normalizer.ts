import { TypedObject } from "@dsqlbase/core/utils";
import { KEY_FIELD } from "@dsqlbase/core/definition";
import { decodeMemberId, getDynamicGuidBinding } from "../nodes.js";
import { GlobalIdError, isGlobalId } from "../../schema/utils/global-id.js";
import {
  AnyColumn,
  AnyTable,
  CountOperationArgs,
  DefinitionSchema,
  DeleteOperationArgs,
  ExecutionContext,
  FieldMutation,
  FieldSelection,
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
  isFilterType,
  JoinExpressionOf,
  OrderByExpressionOf,
  PaginateArgs,
  QueryArgs,
  UpdateArgs,
  UpdateValuesOf,
  WhereExpressionOf,
} from "./base.js";
import {
  CursorKey,
  decodeCursor,
  InvalidCursorError,
  keysetSignature,
} from "../pagination/cursor.js";

/** The page size when neither the call nor the client names one. */
export const DEFAULT_PAGE_SIZE = 100;

interface OrderKey {
  field: string;
  column: AnyColumn;
  direction: "asc" | "desc";
  /** Set on a page's keys only: whether the key can hold `NULL`, so its nulls must be placed. */
  nullable?: boolean;
}

const flip = (direction: "asc" | "desc"): "asc" | "desc" => (direction === "asc" ? "desc" : "asc");

/** What {@link shapePage} reads off a page plan, whichever kind of select produced it. */
export interface PagePlan {
  /** The total order, as the cursor signs it. */
  keys: CursorKey[];
  signature: string;
  take: number;
  bound: KeysetBound;
  cursor?: (string | null)[];
}

/** Everything a union's `paginate` needs besides the select itself. */
export interface UnionPaginateRequest extends PagePlan {
  request: OperationRequest<UnionSelectOperationArgs, "many">;
  /** The same members and filters without the keyset — what a count of the same rows uses. */
  count: OperationRequest<UnionCountOperationArgs, "one">;
}

/** Everything `paginate` needs besides the select itself. */
export interface PaginateRequest {
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
}

export class RequestNormalizer<TDefinition extends DefinitionSchema> implements TypedObject<
  Schema<TDefinition>
> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext;

  constructor(context: ExecutionContext) {
    this._ctx = context;
  }

  private _getWhereExpression<TTable extends AnyTable>(
    table: TTable,
    where: WhereExpressionOf<TTable> | null | undefined
  ): SQLNode | undefined {
    if (!where) {
      return undefined;
    }

    const expressions: SQLNode[] = [];

    for (const [fieldName, condition] of Object.entries(where)) {
      if ((fieldName === "and" || fieldName === "or") && Array.isArray(condition)) {
        const children = condition
          .map((expr) => this._getWhereExpression(table, expr))
          .filter(Boolean) as SQLNode[];

        // An empty group constrains nothing; left in, it would render as `()`.
        if (children.length > 0) {
          expressions.push(sql.wrap(fieldName === "and" ? sql.and(children) : sql.or(children)));
        }

        continue;
      }

      if (
        fieldName === "not" &&
        typeof condition === "object" &&
        condition !== null &&
        !Array.isArray(condition)
      ) {
        const shouldWrapNot = Object.keys(condition).length > 1;
        const expr = this._getWhereExpression(table, condition);

        if (expr) {
          expressions.push(shouldWrapNot ? sql.wrap(sql.not(expr)) : sql.not(expr));
        }

        continue;
      }

      const column = table.getColumn(fieldName);

      if (!column) {
        throw new Error(`Invalid field "${fieldName}" in where clause for table "${table.name}".`);
      }

      const polymorphic = this._getPolymorphicFilter(column, condition);

      if (polymorphic) {
        expressions.push(polymorphic);
        continue;
      }

      // Comparison values go through `column.param` so the column's codec writes them the
      // same way it wrote them on insert. Pattern operators below stay raw: they compare
      // against a `LIKE` pattern, not a column value.
      if (isFilterType(condition, "eq")) {
        expressions.push(sql.eq(column, column.param(condition.eq)));
        continue;
      }

      if (isFilterType(condition, "neq")) {
        expressions.push(sql.ne(column, column.param(condition.neq)));
        continue;
      }

      if (isFilterType(condition, "gt")) {
        expressions.push(sql.gt(column, column.param(condition.gt)));
        continue;
      }

      if (isFilterType(condition, "gte")) {
        expressions.push(sql.gte(column, column.param(condition.gte)));
        continue;
      }

      if (isFilterType(condition, "lt")) {
        expressions.push(sql.lt(column, column.param(condition.lt)));
        continue;
      }

      if (isFilterType(condition, "lte")) {
        expressions.push(sql.lte(column, column.param(condition.lte)));
        continue;
      }

      if (isFilterType(condition, "in")) {
        expressions.push(sql.in(column, condition.in.map((value) => column.param(value))));
        continue;
      }

      if (isFilterType(condition, "between")) {
        expressions.push(
          sql`${column} BETWEEN ${column.param(condition.between[0])} AND ${column.param(
            condition.between[1]
          )}`
        );
        continue;
      }

      if (isFilterType(condition, "exists")) {
        if (condition.exists) {
          expressions.push(sql.isNotNull(column));
        } else {
          expressions.push(sql.isNull(column));
        }
        continue;
      }

      if (isFilterType(condition, "beginsWith")) {
        expressions.push(sql.like(column, `${condition.beginsWith}%`));
        continue;
      }

      if (isFilterType(condition, "endsWith")) {
        expressions.push(sql.like(column, `%${condition.endsWith}`));
        continue;
      }

      if (isFilterType(condition, "contains")) {
        expressions.push(sql.like(column, `%${condition.contains}%`));
        continue;
      }

      // Value shorthand: `{ id: "123" }` means `{ id: { eq: "123" } }`.
      expressions.push(sql.eq(column, column.param(condition as SQLValue)));
    }

    // `{}` selects everything, the same as no `where` at all — not an empty `WHERE`.
    return expressions.length > 0 ? sql.and(expressions) : undefined;
  }

  /**
   * The `where` of an operation that requires one — `findOne`, `update`, `delete` — refusing a
   * filter that selects nothing in particular. `{}` means "every row" everywhere else; here it
   * would pick an arbitrary row to read, or every row to change.
   */
  private _getRequiredWhere<TTable extends AnyTable>(
    table: TTable,
    where: WhereExpressionOf<TTable> | null | undefined,
    operation: string
  ): SQLNode {
    const expression = this._getWhereExpression(table, where);

    if (!expression) {
      throw new Error(
        `${operation} on "${table.name}" needs a where that names the rows it applies to; ` +
          `an empty one would match every row.`
      );
    }

    return expression;
  }

  private _getSelectionEntries<TTable extends AnyTable>(
    table: TTable,
    selection: FieldSelectionOf<TTable> | boolean | null | undefined
  ): FieldSelection[] {
    const entries: FieldSelection[] = [];

    if (!selection || typeof selection === "boolean") {
      return entries;
    }

    for (const [fieldName, isSelected] of Object.entries(selection)) {
      if (isSelected) {
        const column = table.getColumn(fieldName);

        if (!column) {
          throw new Error(`Invalid field "${fieldName}" in selection for table "${table.name}".`);
        }

        entries.push([fieldName, column]);
      }
    }

    return entries;
  }

  /** `orderBy` as resolved keys, in the order the caller wrote them. */
  private _getOrderKeys<TTable extends AnyTable>(
    table: TTable,
    orderBy: OrderByExpressionOf<TTable> | null | undefined
  ): OrderKey[] {
    const keys: OrderKey[] = [];

    for (const [field, direction] of Object.entries(orderBy ?? {})) {
      const column = table.getColumn(field);

      if (!column) {
        throw new Error(`Invalid field "${field}" in orderBy for table "${table.name}".`);
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
   * Refuses a field the members of `union` do not all share, anywhere in a shared `where` —
   * inside `and` / `or` / `not` included. Checked on the union rather than per member, so the
   * error names the union instead of whichever member happened to lack the field.
   */
  private _assertSharedWhere(union: Union, where: Record<string, unknown> | null | undefined) {
    for (const [fieldName, condition] of Object.entries(where ?? {})) {
      if ((fieldName === "and" || fieldName === "or") && Array.isArray(condition)) {
        for (const child of condition) {
          this._assertSharedWhere(union, child as Record<string, unknown>);
        }

        continue;
      }

      if (fieldName === "not" && typeof condition === "object" && condition !== null) {
        this._assertSharedWhere(union, condition as Record<string, unknown>);
        continue;
      }

      if (fieldName === KEY_FIELD) {
        this._getKeyCondition(union, condition);
        continue;
      }

      if (!union.isShared(fieldName)) {
        throw new Error(
          `Invalid field "${fieldName}" in where for union "${union.alias}": only fields every ` +
            `member shares filter across a union. Filter one member through \`on\`.`
        );
      }
    }
  }

  /**
   * A `$$key` condition as a test on a member alias. `$$key` accepts `eq`, `neq`, `in` and the
   * bare-value shorthand, each naming member aliases; anything else — another operator, a
   * value that is not a member — is refused, since it could only ever be a typo.
   */
  private _getKeyCondition(union: Union, condition: unknown): (alias: string) => boolean {
    const assertMembers = (values: unknown[]) => {
      for (const value of values) {
        if (typeof value !== "string" || !union.hasMember(value)) {
          throw new Error(
            `${KEY_FIELD} in where for union "${union.alias}" names ${JSON.stringify(value)}, ` +
              `which is not a member (members: ${union.memberAliases.join(", ")}).`
          );
        }
      }
    };

    if (typeof condition === "string") {
      assertMembers([condition]);
      return (alias) => alias === condition;
    }

    const entries = Object.entries((condition ?? {}) as Record<string, unknown>).filter(
      ([, value]) => value !== undefined
    );

    const tests = entries.map(([operator, value]): ((alias: string) => boolean) => {
      if (operator === "eq" || operator === "neq") {
        assertMembers([value]);
        return operator === "eq" ? (alias) => alias === value : (alias) => alias !== value;
      }

      if (operator === "in" && Array.isArray(value)) {
        assertMembers(value);
        return (alias) => value.includes(alias);
      }

      throw new Error(
        `${KEY_FIELD} in where for union "${union.alias}" accepts eq, neq and in; got "${operator}".`
      );
    });

    return (alias) => tests.every((test) => test(alias));
  }

  /**
   * A shared `where` as seen from one member, with every `$$key` condition decided.
   *
   * Inside a branch the member alias is a constant, so a `$$key` condition is simply true or
   * false there. Folding it away here, rather than rendering `'photos' = 'videos'` into SQL,
   * lets a member that can never match be pruned before a branch is built at all:
   *
   * - `false` — no row of this member can match; the member produces no branch;
   * - otherwise the `where` that is left, with every decided condition removed. An `or` holding
   *   a true child is dropped whole; a `not` flips its child.
   */
  private _foldKeyWhere(
    union: Union,
    where: Record<string, unknown>,
    alias: string
  ): Record<string, unknown> | false {
    const residual: Record<string, unknown> = {};

    for (const [fieldName, condition] of Object.entries(where)) {
      if (fieldName === KEY_FIELD) {
        if (!this._getKeyCondition(union, condition)(alias)) {
          return false;
        }

        continue;
      }

      if ((fieldName === "and" || fieldName === "or") && Array.isArray(condition)) {
        // An empty group constrains nothing, exactly as outside a union.
        if (condition.length === 0) {
          continue;
        }

        const children = condition.map((child) =>
          this._foldKeyWhere(union, child as Record<string, unknown>, alias)
        );

        if (fieldName === "and") {
          if (children.some((child) => child === false)) {
            return false;
          }

          const kept = children.filter((child) => Object.keys(child as object).length > 0);

          if (kept.length > 0) {
            residual.and = kept;
          }

          continue;
        }

        // `or`: one child true for this member makes the whole group true.
        if (children.some((child) => child !== false && Object.keys(child).length === 0)) {
          continue;
        }

        const kept = children.filter((child) => child !== false);

        if (kept.length === 0) {
          return false;
        }

        residual.or = kept;
        continue;
      }

      if (fieldName === "not" && typeof condition === "object" && condition !== null) {
        const inner = this._foldKeyWhere(union, condition as Record<string, unknown>, alias);

        if (inner === false) {
          continue;
        }

        if (Object.keys(inner).length === 0 && Object.keys(condition).length > 0) {
          return false;
        }

        residual.not = inner;
        continue;
      }

      residual[fieldName] = condition;
    }

    return residual;
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

    this._assertSharedWhere(union, args.where as Record<string, unknown> | undefined);

    const members: [string, SelectOperationArgs][] = [];

    for (const alias of union.memberAliases) {
      const entry = on[alias];

      if (entry === false) {
        continue;
      }

      const sharedWhere = args.where
        ? this._foldKeyWhere(union, args.where as Record<string, unknown>, alias)
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
      const extra = this._getSelectionEntries(member, own.select).filter(
        ([field]) => !sharedSelect.includes(field)
      );

      const where = [
        this._getWhereExpression(member, sharedWhere as WhereExpressionOf<AnyTable> | undefined),
        this._getWhereExpression(member, own.where),
      ].filter((node): node is SQLNode => node !== undefined);

      members.push([
        alias,
        {
          select: [...shared, ...extra],
          where: where.length > 0 ? where : undefined,
          join: this._getJoinEntries(member, own.join),
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

      if (!column) {
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

  /**
   * A filter on a polymorphic id. A global id names a member as well as a key, and two members
   * may hold the same key, so matching it takes both: `(discriminator = key AND id = pk)`. `in`
   * becomes an `OR` of such groups, raw uuids among them compared on the id alone. `undefined`
   * for any other operator, or a filter with no global id in it — the ordinary path handles those.
   */
  private _getPolymorphicFilter(column: AnyColumn, condition: unknown): SQLNode | undefined {
    const binding = getDynamicGuidBinding(column);

    if (!binding) {
      return undefined;
    }

    const { discriminator, members } = binding;
    const match = (value: unknown) => {
      const member = decodeMemberId(value, members);

      return member
        ? sql.and([
            sql.eq(discriminator, discriminator.param(member.key)),
            sql.eq(column, column.param(member.value)),
          ])
        : undefined;
    };

    if (isFilterType(condition, "in")) {
      const values = condition.in as unknown[];

      if (!values.some(isGlobalId)) {
        return undefined;
      }

      const raw = values.filter((value) => !isGlobalId(value));
      const groups: SQLNode[] = values.flatMap((value) =>
        isGlobalId(value) ? [sql.wrap(match(value) as SQLNode)] : []
      );

      if (raw.length > 0) {
        groups.push(sql.in(column, raw.map((value) => column.param(value as SQLValue))));
      }

      return sql.wrap(sql.or(groups));
    }

    if (isFilterType(condition, "neq")) {
      const group = match(condition.neq);
      return group ? sql.not(group) : undefined;
    }

    const value = isFilterType(condition, "eq") ? condition.eq : condition;
    const group = typeof value === "string" ? match(value) : undefined;

    return group ? sql.wrap(group) : undefined;
  }

  private _getSelectArgs<TTable extends AnyTable>(
    table: TTable,
    args: QueryArgs<TTable, this["__type"]>
  ): SelectOperationArgs {
    const selection = this._getSelectionEntries(table, args.select);
    const where = this._getWhereExpression(table, args.where);
    const join = this._getJoinEntries(table, args.join);
    const orderBy = this._getOrderByEntries(table, args.orderBy);

    return {
      select: selection,
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
      request.where = this._getRequiredWhere(table, args.where, "findOne");
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
    const where = this._getWhereExpression(table, args.where);
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
      args: { where: this._getWhereExpression(table, args.where) },
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
    const where = this._getRequiredWhere(table, args.where, "update");
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
    const where = this._getRequiredWhere(table, args.where, "delete");
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
