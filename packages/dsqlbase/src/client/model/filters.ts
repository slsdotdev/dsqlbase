import { KEY_FIELD } from "@dsqlbase/core/definition";
import type {
  AnyColumnDefinition,
  ColumnConfig,
  ColumnRuntimeType,
} from "@dsqlbase/core/definition";
import {
  AnyColumn,
  AnyColumnGroup,
  AnyTable,
  Column,
  ColumnGroup,
  sql,
  SQLNode,
  SQLValue,
  Union,
} from "@dsqlbase/core";
import type { Prettify } from "@dsqlbase/core/utils";
import { decodeMemberId, getDynamicGuidBinding } from "../nodes.js";
import { isGlobalId } from "../../schema/utils/global-id.js";
import type {
  ColumnTypeOf,
  ColumnFieldNamesOf,
  GroupFieldNamesOf,
  GroupOf,
  ValueTypeOf,
} from "./base.js";

/**
 * The `where` language: what a column of each runtime type can be filtered and ordered by, the
 * filter types written from that table, and {@link WhereBuilder}, which enforces it while
 * turning a `where` object into SQL. An operator the types refuse is also refused at runtime —
 * before any SQL is built.
 */

const COMPARISON = ["eq", "neq", "in", "gt", "gte", "lt", "lte", "between", "exists"] as const;
const PATTERN = ["beginsWith", "endsWith", "contains"] as const;
const KEYED = ["hasKey"] as const;

export type FilterOperator =
  | (typeof COMPARISON)[number]
  | (typeof PATTERN)[number]
  | (typeof KEYED)[number];

export type RuntimeTypeRules = {
  /** The operators a filter on the column may use. */
  operators: readonly FilterOperator[];
  /** Whether a bare value stands for `{ eq: value }`. */
  shorthand: boolean;
  /** Whether the column can be an `orderBy` key. */
  orderable: boolean;
  /** Whether the database can compare two values for equality, which `distinct` needs. */
  distinct: boolean;
};

const comparable: RuntimeTypeRules = {
  operators: COMPARISON,
  shorthand: true,
  orderable: true,
  distinct: true,
};
const document: RuntimeTypeRules = {
  operators: ["exists"],
  shorthand: false,
  orderable: false,
  distinct: true,
};

/**
 * `jsonb` equality and containment. `contains` means `@>` here, not `LIKE`: the value is a
 * fragment of a document, matched recursively.
 */
const jsonbDocument: RuntimeTypeRules = {
  ...document,
  operators: ["eq", "neq", "contains", "exists"],
};

export const RUNTIME_TYPE_RULES: Readonly<Record<ColumnRuntimeType, RuntimeTypeRules>> = {
  string: { ...comparable, operators: [...COMPARISON, ...PATTERN] },
  uuid: comparable,
  number: comparable,
  bigint: comparable,
  date: comparable,
  interval: comparable,
  boolean: { ...comparable, operators: ["eq", "neq", "exists"] },
  bytes: document,
  // `json` has no equality operator at all.
  json: { ...document, distinct: false },
  jsonb: jsonbDocument,
  array: jsonbDocument,
  object: { ...jsonbDocument, operators: [...jsonbDocument.operators, ...KEYED] },
};

/** Every operator any runtime type accepts — what tells an operator object from a value. */
export const FILTER_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...COMPARISON,
  ...PATTERN,
  ...KEYED,
]);

/**
 * Inside a column's filter, `where` is reserved for filtering into the column's value — a
 * document's keys, later an embedded object's members. Reserved so that no operator takes the
 * name; not supported yet.
 */
export const NESTED_FILTER = "where";

/** The runtime types stored as `jsonb`, where `contains` is containment (`@>`). */
export const JSONB_RUNTIME_TYPES: ReadonlySet<ColumnRuntimeType> = new Set([
  "jsonb",
  "array",
  "object",
]);

export function rulesOf(column: AnyColumn): RuntimeTypeRules {
  return RUNTIME_TYPE_RULES[column.runtimeType];
}

/* -------------------------------------------------------------------------------------------
 * The same table, at type level
 * ---------------------------------------------------------------------------------------- */

/** The operators a runtime type accepts. Mirrors {@link RUNTIME_TYPE_RULES}. */
export type OperatorsOf<R extends ColumnRuntimeType> = R extends "string"
  ? (typeof COMPARISON)[number] | (typeof PATTERN)[number]
  : R extends "uuid" | "number" | "bigint" | "date" | "interval"
    ? (typeof COMPARISON)[number]
    : R extends "boolean"
      ? "eq" | "neq" | "exists"
      : R extends "object"
        ? "eq" | "neq" | "contains" | "hasKey" | "exists"
        : R extends JsonbRuntimeType
          ? "eq" | "neq" | "contains" | "exists"
          : "exists";

/** The runtime types stored as `jsonb`. Mirrors {@link JSONB_RUNTIME_TYPES}. */
export type JsonbRuntimeType = "jsonb" | "array" | "object";

/**
 * What `contains` takes on runtime type `R` holding `V`: a substring on `string`, a fragment of
 * the document on a `jsonb` type — never `null`, and anything on an untyped document. On `array`
 * the fragment is itself an array, of item fragments.
 */
export type ContainsValueOf<R extends ColumnRuntimeType, V> = R extends "string"
  ? string
  : R extends JsonbRuntimeType
    ? unknown extends V
      ? unknown
      : JsonFragment<NonNullable<V>>
    : never;

/**
 * A part of a JSON value, as `@>` matches it: any object member may be left out, at any depth,
 * and an array lists some of its items.
 */
export type JsonFragment<T> = T extends Date
  ? T
  : T extends readonly (infer I)[]
    ? JsonFragment<I>[]
    : T extends object
      ? { [K in keyof T]?: JsonFragment<T[K]> }
      : T;

/** The runtime types where a bare value stands for `{ eq: value }`. */
export type ShorthandRuntimeType =
  | "string"
  | "uuid"
  | "number"
  | "bigint"
  | "date"
  | "interval"
  | "boolean";

/** The runtime types a column can be ordered by. */
export type OrderableRuntimeType = ShorthandRuntimeType;

/* -------------------------------------------------------------------------------------------
 * Filter types
 * ---------------------------------------------------------------------------------------- */

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
};

/**
 * A filter on a value of runtime type `R` holding `V`: the operators the runtime type allows,
 * and, where it allows one, a bare value meaning `{ eq: value }`. Mirrors
 * {@link RUNTIME_TYPE_RULES}, which {@link WhereBuilder} enforces.
 */
export type FilterOf<R extends ColumnRuntimeType, V> =
  | Prettify<
      Pick<FilterCondition<V>, Exclude<OperatorsOf<R>, "contains">> &
        ("contains" extends OperatorsOf<R> ? { contains?: ContainsValueOf<R, V> } : unknown)
    >
  | (R extends ShorthandRuntimeType ? V : never);

/** The filter a column accepts. */
export type ColumnFilterOf<C extends ColumnConfig> = FilterOf<C["runtimeType"], ValueTypeOf<C>>;

export type WhereExpressionOf<T extends AnyTable> = {
  [K in ColumnFieldNamesOf<T>]?: T["__type"]["columns"][K] extends AnyColumnDefinition
    ? ColumnFilterOf<ColumnTypeOf<T, K>>
    : never;
} & {
  and?: WhereExpressionOf<T>[];
  or?: WhereExpressionOf<T>[];
  not?: WhereExpressionOf<T>;
} & ([GroupFieldNamesOf<T>] extends [never]
    ? unknown
    : {
        [K in GroupFieldNamesOf<T>]?: T["__type"]["columns"][K] extends GroupOf<infer C>
          ? GroupFilterOf<C>
          : never;
      });

/**
 * A column group's filter: whether it is present, and a nested `where` over its members. Members
 * are named only inside `where`, never beside `exists`.
 */
export type GroupFilterOf<C> = {
  exists?: boolean;
  where?: MembersWhereOf<C>;
};

/** A nested `where` over a group's members: the same language as a table's. */
export type MembersWhereOf<C> = {
  -readonly [K in keyof C]?: C[K] extends GroupOf<infer GC>
    ? GroupFilterOf<GC>
    : C[K] extends { __type: infer TConfig extends ColumnConfig }
      ? ColumnFilterOf<TConfig>
      : never;
} & {
  and?: MembersWhereOf<C>[];
  or?: MembersWhereOf<C>[];
  not?: MembersWhereOf<C>;
};

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
 * Building
 * ---------------------------------------------------------------------------------------- */

/**
 * Turns a `where` object into one SQL node, checking every operator against the column's runtime
 * type, encoding every value through the column's codec, and — across a union — checking shared
 * fields and deciding `$$key` per member.
 */
export class WhereBuilder {
  public build<TTable extends AnyTable>(
    table: TTable,
    where: WhereExpressionOf<TTable> | null | undefined
  ): SQLNode | undefined {
    return this._build(table, undefined, where as Record<string, unknown> | null | undefined);
  }

  /**
   * A `where` over the fields of `table`, or — inside a group's nested `where` — over the members
   * of `group`. The same language at every level: fields, `and` / `or` / `not`.
   */
  private _build(
    table: AnyTable,
    group: AnyColumnGroup | undefined,
    where: Record<string, unknown> | null | undefined,
    path: string[] = []
  ): SQLNode | undefined {
    if (!where) {
      return undefined;
    }

    const expressions: SQLNode[] = [];

    for (const [fieldName, condition] of Object.entries(where)) {
      if ((fieldName === "and" || fieldName === "or") && Array.isArray(condition)) {
        const children = condition
          .map((expr) => this._build(table, group, expr as Record<string, unknown>, path))
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
        const expr = this._build(table, group, condition as Record<string, unknown>, path);

        if (expr) {
          expressions.push(shouldWrapNot ? sql.wrap(sql.not(expr)) : sql.not(expr));
        }

        continue;
      }

      const field = group ? group.getColumn(fieldName) : table.getColumn(fieldName);
      const fieldPath = [...path, fieldName].join(".");

      if (field instanceof ColumnGroup) {
        expressions.push(...this._getGroupFilter(table, [...path, fieldName], field, condition));
        continue;
      }

      if (!(field instanceof Column)) {
        throw new Error(`Invalid field "${fieldPath}" in where clause for table "${table.name}".`);
      }

      expressions.push(...this._getColumnFilter(table, fieldPath, field, condition));
    }

    // `{}` selects everything, the same as no `where` at all — not an empty `WHERE`.
    return expressions.length > 0 ? sql.and(expressions) : undefined;
  }

  /**
   * One column's filter, as its runtime type allows ({@link RUNTIME_TYPE_RULES}): a bare value means
   * `{ eq: value }` where the type takes one, and every operator in an object adds a condition,
   * AND-ed with the rest. Anything the type does not allow throws before SQL is built.
   */
  private _getColumnFilter(
    table: AnyTable,
    fieldName: string,
    column: AnyColumn,
    condition: unknown
  ): SQLNode[] {
    const rules = rulesOf(column);
    const subject = `${column.runtimeType} column "${fieldName}" of "${table.name}"`;

    if (!this._isOperatorObject(condition)) {
      if (!rules.shorthand) {
        throw new Error(
          `Filter the ${subject} with one of its operators (${rules.operators.join(", ")}), ` +
            `not a bare value.`
        );
      }

      // Value shorthand: `{ id: "123" }` means `{ id: { eq: "123" } }`.
      return [this._getOperatorFilter(column, "eq", condition)];
    }

    const nodes: SQLNode[] = [];

    for (const [operator, value] of Object.entries(condition)) {
      if (value === undefined) {
        continue;
      }

      if (operator === NESTED_FILTER) {
        throw new Error(`A nested \`where\` on the ${subject} is not supported yet.`);
      }

      if (!rules.operators.includes(operator as FilterOperator)) {
        throw new Error(
          FILTER_OPERATORS.has(operator)
            ? `Operator "${operator}" is not valid on the ${subject} ` +
                `(valid: ${rules.operators.join(", ")}).`
            : `Unknown operator "${operator}" in the filter on the ${subject}.`
        );
      }

      nodes.push(this._getOperatorFilter(column, operator as FilterOperator, value));
    }

    return nodes;
  }

  /**
   * A column group's filter: `exists` — whether the group is present, by the rule it is read
   * `null` by — and the nested `where` over its members. Members are only ever named inside
   * `where`, so a member called `exists` cannot be mistaken for the operator.
   */
  private _getGroupFilter(
    table: AnyTable,
    path: string[],
    group: AnyColumnGroup,
    condition: unknown
  ): SQLNode[] {
    const subject = `group "${path.join(".")}" of "${table.name}"`;

    if (
      typeof condition !== "object" ||
      condition === null ||
      Array.isArray(condition) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(condition) as object | null)
    ) {
      throw new Error(`Filter the ${subject} with \`exists\` or a nested \`where\`, not a value.`);
    }

    const nodes: SQLNode[] = [];

    for (const [operator, value] of Object.entries(condition)) {
      if (value === undefined) {
        continue;
      }

      if (operator === "exists") {
        nodes.push(group.exists(Boolean(value)));
        continue;
      }

      if (operator === NESTED_FILTER) {
        const nested = this._build(table, group, value as Record<string, unknown>, path);

        if (nested) {
          nodes.push(nested);
        }

        continue;
      }

      throw new Error(
        `Operator "${operator}" is not valid on the ${subject} (valid: exists, ${NESTED_FILTER}); ` +
          `filter its members inside \`${NESTED_FILTER}\`.`
      );
    }

    return nodes;
  }

  /**
   * Whether a column's filter is an object of operators rather than a value: a plain object
   * naming at least one. A value can itself be a plain object — an `interval` read as a
   * `Duration`, a JSON document — so one that names no operator is a value.
   */
  private _isOperatorObject(condition: unknown): condition is Record<string, unknown> {
    if (typeof condition !== "object" || condition === null) {
      return false;
    }

    const prototype = Object.getPrototypeOf(condition) as unknown;

    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }

    return Object.keys(condition).some((key) => FILTER_OPERATORS.has(key) || key === NESTED_FILTER);
  }

  private _getOperatorFilter(column: AnyColumn, operator: FilterOperator, value: unknown): SQLNode {
    // Comparison values go through `column.param` so the column's codec writes them the same
    // way it wrote them on insert. Pattern operators stay raw: they compare against a `LIKE`
    // pattern, not a column value. A `jsonb` fragment is encoded but, like every filter value,
    // not validated, so a partial document reaches the database as given.
    switch (operator) {
      case "eq":
        return (
          this._getPolymorphicFilter(column, value) ??
          sql.eq(column, column.param(value as SQLValue))
        );
      case "neq":
        return (
          this._getPolymorphicFilter(column, { neq: value }) ??
          sql.ne(column, column.param(value as SQLValue))
        );
      case "in":
        return (
          this._getPolymorphicFilter(column, { in: value }) ??
          sql.in(
            column,
            (value as SQLValue[]).map((item) => column.param(item))
          )
        );
      case "gt":
        return sql.gt(column, column.param(value as SQLValue));
      case "gte":
        return sql.gte(column, column.param(value as SQLValue));
      case "lt":
        return sql.lt(column, column.param(value as SQLValue));
      case "lte":
        return sql.lte(column, column.param(value as SQLValue));
      case "between": {
        const [from, to] = value as [SQLValue, SQLValue];
        return sql`${column} BETWEEN ${column.param(from)} AND ${column.param(to)}`;
      }
      case "exists":
        return value ? sql.isNotNull(column) : sql.isNull(column);
      case "beginsWith":
        return sql.like(column, `${value as string}%`);
      case "endsWith":
        return sql.like(column, `%${value as string}`);
      case "contains":
        if (!JSONB_RUNTIME_TYPES.has(column.runtimeType)) {
          return sql.like(column, `%${value as string}%`);
        }

        // On an array column the fragment lists items; a lone item would be ambiguous when the
        // items are themselves arrays.
        if (column.runtimeType === "array" && !Array.isArray(value)) {
          throw new Error(
            `\`contains\` on the array column "${column.name}" of "${column.table.name}" ` +
              `takes an array of items.`
          );
        }

        return sql.jsonbContains(column, column.param(value as SQLValue));
      case "hasKey":
        // A key, not a value: sent as is, never through the codec.
        return sql.jsonbHasKey(column, value as string);
    }
  }

  /**
   * The `where` of an operation that requires one — `findOne`, `update`, `delete` — refusing a
   * filter that selects nothing in particular. `{}` means "every row" everywhere else; here it
   * would pick an arbitrary row to read, or every row to change.
   */
  public buildRequired<TTable extends AnyTable>(
    table: TTable,
    where: WhereExpressionOf<TTable> | null | undefined,
    operation: string
  ): SQLNode {
    const expression = this.build(table, where);

    if (!expression) {
      throw new Error(
        `${operation} on "${table.name}" needs a where that names the rows it applies to; ` +
          `an empty one would match every row.`
      );
    }

    return expression;
  }

  /**
   * Refuses a field the members of `union` do not all share, anywhere in a shared `where` —
   * inside `and` / `or` / `not` included. Checked on the union rather than per member, so the
   * error names the union instead of whichever member happened to lack the field.
   */
  public assertShared(union: Union, where: Record<string, unknown> | null | undefined) {
    for (const [fieldName, condition] of Object.entries(where ?? {})) {
      if ((fieldName === "and" || fieldName === "or") && Array.isArray(condition)) {
        for (const child of condition) {
          this.assertShared(union, child as Record<string, unknown>);
        }

        continue;
      }

      if (fieldName === "not" && typeof condition === "object" && condition !== null) {
        this.assertShared(union, condition as Record<string, unknown>);
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
  public foldKey(
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
          this.foldKey(union, child as Record<string, unknown>, alias)
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
        const inner = this.foldKey(union, condition as Record<string, unknown>, alias);

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
        groups.push(
          sql.in(
            column,
            raw.map((value) => column.param(value as SQLValue))
          )
        );
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
}
