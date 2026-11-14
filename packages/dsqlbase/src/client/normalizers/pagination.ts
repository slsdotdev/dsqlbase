import {
  AnyTable,
  AnyUnion,
  DefinitionSchema,
  OperationRequest,
  OperationResult,
  OrderByEntry,
  Schema,
  SelectOperation,
  SelectOperationArgs,
  Union,
  UnionSelectOperation,
  UnionSelectOperationArgs,
} from "@dsqlbase/core";
import { ClientContext } from "./context.js";
import {
  PaginatedQueryArgs,
  PaginatedQueryResultOf,
  PaginatedUnionQueryArgs,
  RuntimeObject,
} from "./base.js";
import { isDefined, isPlainObject } from "./utils.js";
import { hash } from "node:crypto";
import { KEY_FIELD } from "@dsqlbase/core/definition";

/** Page-size bounds for keyset pagination. Carried here for the client; core reads neither. */
export type PaginationOptions = {
  /** The page size when a call names none. */
  defaultLimit?: number;
  /** The largest page size a call may ask for. Unbounded when absent. */
  maxLimit?: number;
};

export const DEFAULT_PAGE_SIZE = 100;

export class PaginationHandler<TDefinition extends DefinitionSchema> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ClientContext<TDefinition>;

  private readonly _defaultPageSize: number;
  private readonly _maxPageSize: number;
  public readonly options: PaginationOptions;

  constructor(context: ClientContext<TDefinition>, options?: PaginationOptions) {
    this.options = options ?? {};
    this._ctx = context;
    this._defaultPageSize = options?.defaultLimit ?? DEFAULT_PAGE_SIZE;
    this._maxPageSize = options?.maxLimit ?? DEFAULT_PAGE_SIZE;
  }

  private _assertCursors(query: PaginatedQueryArgs<AnyTable, this["__type"]>) {
    if (isDefined(query.before) && isDefined(query.after)) {
      throw new Error("Pass either after or before, not both.");
    }
  }

  private _assertUnionTiebreaker<T extends AnyUnion>(union: T) {
    if (union.tiebreakers === 0) {
      throw new Error(
        `Cannot page union "${union.alias}": its members' primary keys differ in arity or type, ` +
          `so nothing can break a tie between two members' rows.`
      );
    }
  }

  private _getPageSize(limit?: number | null): number {
    const size = limit ?? this._defaultPageSize;
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`A page size must be a positive integer (got ${String(size)}).`);
    }

    if (size > this._maxPageSize) {
      throw new Error(
        `A page size must not exceed the maximum limit of ${this._maxPageSize} (got ${String(size)}).`
      );
    }

    return size;
  }

  private _getOrderKeyset(
    table: RuntimeObject,
    entries: OrderByEntry[] | null | undefined,
    direction: "asc" | "desc"
  ) {
    const keys = entries ?? [];

    if (table instanceof Union) {
      if (!keys.some(([field]) => field === KEY_FIELD)) {
        keys.push([KEY_FIELD, [direction]]);
      }

      for (const [index] of Array.from({ length: table.tiebreakers }).entries()) {
        keys.push([`$$pk${index}`, [direction]]);
      }

      return keys;
    }

    const fields = new Map(table.getColumnEntries().map(([field, column]) => [column, field]));

    for (const column of table.primaryKey) {
      if (!keys.some((key) => table.getColumn(key[0]) === column)) {
        keys.push([fields.get(column) as string, [direction]]);
      }
    }

    return keys;
  }

  private _createKeysetSignature(table: RuntimeObject, keyset: OrderByEntry[]) {
    const order = keyset.map(([field, [direction]]) => `${field}:${direction}`).join(",");
    return hash("sha256", `${table.alias}|${order}`, "hex").slice(0, 8);
  }

  private _getCursorValues(
    cursor: string,
    signature: string,
    keyset: OrderByEntry[]
  ): (string | null)[] {
    if (typeof cursor !== "string" || !VERSIONED.test(cursor)) {
      throw new InvalidCursorError("format", `"${String(cursor)}" is not a cursor.`);
    }

    if (!cursor.startsWith(CURSOR_PREFIX)) {
      throw new InvalidCursorError(
        "version",
        `"${cursor}" is from another cursor format; this client reads "${CURSOR_PREFIX}".`
      );
    }

    const payload = decodeCursor(cursor);

    if (!Array.isArray(payload) || typeof payload[0] !== "string") {
      throw new InvalidCursorError(
        "format",
        `"${cursor}" does not carry a [signature, ...] payload.`
      );
    }

    const [checksum, ...values] = payload as [string, ...unknown[]];

    if (checksum !== signature || values.length !== keyset.length) {
      throw new InvalidCursorError(
        "mismatch",
        `"${cursor}" was taken under another table or order; pass the same orderBy it came from.`
      );
    }

    for (const [index, value] of values.entries()) {
      if (typeof value !== "string" && value !== null) {
        throw new InvalidCursorError("format", `"${cursor}" carries a key that is not text.`);
      }

      if (value === null && !isDefined(keyset[index][1][1])) {
        throw new InvalidCursorError(
          "format",
          `"${cursor}" carries a null for a key that cannot hold one.`
        );
      }
    }

    return values as (string | null)[];
  }

  private _getUnionMemberFieldName(union: AnyUnion, alias: string, key: string) {
    if (key === KEY_FIELD) {
      return alias;
    }

    const member = union.getMember(alias);
    const fields = new Map(member.getColumnEntries().map(([field, column]) => [column, field]));

    if (key.startsWith("$$pk")) {
      const column = member.primaryKey[Number(key.slice(4))];

      if (!column) {
        throw new Error(`Invalid primary key index in key "${key}".`);
      }

      return fields.get(column) as string;
    }

    return key;
  }
  private _getPaginationPlan<TTable extends RuntimeObject>(
    table: TTable,
    query: TTable extends AnyUnion
      ? PaginatedUnionQueryArgs<TTable, this["__type"]>
      : PaginatedQueryArgs<TTable, this["__type"]>,
    request:
      | OperationRequest<SelectOperationArgs, "many">
      | OperationRequest<UnionSelectOperationArgs, "many">
  ): PaginationPlan {
    this._assertCursors(query);

    const pageSize = this._getPageSize(query.limit);
    const direction = request.args.orderBy?.at(-1)?.[1][0] ?? "asc";
    const keyset = this._getOrderKeyset(table, request.args.orderBy, direction);
    const signature = this._createKeysetSignature(table, keyset);
    const cursor = query.after ?? query.before ?? undefined;
    const projection = isDefined(query.before) ? "before" : "after";

    return {
      pageSize,
      direction,
      projection,
      signature,
      keyset,
      cursor,
    };
  }

  private _createPageResolver<
    TTable extends AnyTable,
    TArgs extends PaginatedQueryArgs<TTable, this["__type"]>,
    TResult,
  >(plan: PaginationPlan, rowResolver: (rows: unknown[]) => OperationResult<"many", TResult>) {
    return (rows: unknown[]): PaginatedQueryResultOf<TTable, Schema<TDefinition>, TArgs> => {
      const hasMore = rows.length > plan.pageSize;
      const records = hasMore ? rows.slice(0, plan.pageSize) : rows;
      const resolved = rowResolver(records);

      const items = resolved.map((record, index) => {
        const values = plan.keyset.map((_, key) => {
          if (!isPlainObject(records[index])) {
            throw new Error(`Expected record at index ${index} to be a plain object.`);
          }

          return records[index][`__k${key}`] as string | null;
        });

        const cursor = encodeCursor(plan.signature, values);

        // `$$meta` is the table's frozen, shared meta object: copied, never written to.
        return { ...record, $$meta: { cursor } };
      });

      // Read backwards, the page arrives nearest-the-cursor first; put it back in order.
      if (plan.projection === "before") {
        items.reverse();
      }

      return {
        items,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].$$meta.cursor : null,
      } as PaginatedQueryResultOf<TTable, Schema<TDefinition>, TArgs>;
    };
  }

  public paginateRequest<
    TTable extends AnyTable,
    TArgs extends PaginatedQueryArgs<TTable, this["__type"]>,
  >(table: TTable, query: TArgs, request: OperationRequest<SelectOperationArgs, "many">) {
    const plan = this._getPaginationPlan(table, query, request);

    request.args.orderBy = plan.keyset;
    request.args.limit = plan.pageSize + 1;
    request.args.keys = plan.keyset.map(([field]) => table.getColumn(field)).filter(isDefined);

    // A page before the cursor is read backwards — every direction flipped — and put back in
    // order once it is resolved, so the rows nearest the cursor are the ones kept.
    if (plan.projection === "before") {
      request.args.orderBy = plan.keyset.map(
        ([field, [direction, nulls]]) =>
          [field, [direction === "asc" ? "desc" : "asc", nulls]] as OrderByEntry
      );
    }

    if (isDefined(plan.cursor)) {
      const values = this._getCursorValues(plan.cursor, plan.signature, plan.keyset);
      const clause = this._ctx.where.buildKeyset(table, plan.keyset, values, plan.projection);

      request.args.where = Array.isArray(request.args.where)
        ? [...request.args.where, clause]
        : [request.args.where, clause].filter(isDefined);
    }

    return <TResult>(operation: SelectOperation<"many", SelectOperationArgs, TResult>) => {
      const { resolve, ...rest } = operation;

      return {
        ...rest,
        resolve: this._createPageResolver(plan, resolve),
      };
    };
  }

  public paginateUnionRequest<TUnion extends AnyUnion>(
    union: TUnion,
    args: PaginatedUnionQueryArgs<TUnion, this["__type"]>,
    request: OperationRequest<UnionSelectOperationArgs, "many">
  ) {
    this._assertUnionTiebreaker(union);

    const plan = this._getPaginationPlan<AnyUnion>(union, args, request);

    let orderBy = plan.keyset;

    request.args.orderBy = orderBy;
    request.args.limit = plan.pageSize + 1;
    request.args.keys = true;
    request.args.tiebreak = plan.direction;

    if (plan.projection === "before") {
      orderBy = plan.keyset.map(
        ([field, [direction, nulls]]) =>
          [field, [direction === "asc" ? "desc" : "asc", nulls]] as OrderByEntry
      );
      request.args.orderBy = orderBy;
    }

    let values: (string | null)[] | undefined = undefined;

    if (isDefined(plan.cursor)) {
      values = this._getCursorValues(plan.cursor, plan.signature, plan.keyset);
      request.args.keyset = { values, bound: plan.projection };
    }

    for (const [index, [member, subquery]] of request.args.members.entries()) {
      const memberKeyset = orderBy
        .filter(([field]) => field !== KEY_FIELD)
        .map<OrderByEntry>(([field, options]) => [
          this._getUnionMemberFieldName(union, member, field),
          options,
        ]);

      request.args.members[index][1].orderBy = memberKeyset;

      if (values) {
        const clause = this._ctx.where.buildKeyset(
          union.getMember(member),
          orderBy.map<OrderByEntry>(([field, options]) => [
            this._getUnionMemberFieldName(union, member, field),
            options,
          ]),
          values,
          plan.projection
        );

        request.args.members[index][1].where = Array.isArray(subquery.where)
          ? [...subquery.where, clause]
          : [subquery.where, clause].filter(isDefined);
      }
    }

    return <TResult>(
      operation: UnionSelectOperation<"many", UnionSelectOperationArgs, TResult>
    ) => {
      const { resolve, ...rest } = operation;

      return {
        ...rest,
        resolve: this._createPageResolver(plan, resolve),
      };
    };
  }
}

export type PaginationPlan = {
  readonly pageSize: number;
  readonly signature: string;
  readonly projection: "before" | "after";
  readonly direction: "asc" | "desc";
  readonly keyset: OrderByEntry[];
  readonly cursor?: string;
};

/** What was wrong with a cursor. */
export type InvalidCursorCode =
  /** Not a readable cursor at all. */
  | "format"
  /** A cursor from another version of the format. */
  | "version"
  /** A readable cursor taken under another table or another order. */
  | "mismatch";

/**
 * A cursor could not be used for this page.
 *
 * Thrown before any SQL is built. `mismatch` is the one a caller is most likely to meet: a
 * cursor reused after the `orderBy` changed, or handed to another model.
 */
export class InvalidCursorError extends Error {
  readonly code: InvalidCursorCode;

  constructor(code: InvalidCursorCode, message: string) {
    super(message);

    this.name = "InvalidCursorError";
    this.code = code;
  }
}

export const CURSOR_PREFIX = "c1.";

const VERSIONED = /^c\d+\./;

function decodeCursor(cursor: string): unknown {
  // `Buffer.from(..., "base64url")` never throws — it drops whatever it cannot read — so
  // malformed base64 surfaces here as JSON that does not parse.
  const json = Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");

  try {
    return JSON.parse(json);
  } catch {
    throw new InvalidCursorError("format", `"${cursor}" does not decode to a JSON payload.`);
  }
}

export function encodeCursor(signature: string, values: (string | null)[]): string {
  const payload = JSON.stringify([signature, ...values]);

  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}
