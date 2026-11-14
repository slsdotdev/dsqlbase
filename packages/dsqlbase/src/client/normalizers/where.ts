import { AnyColumn, AnyTable, OrderByEntry, sql, SQLNode } from "@dsqlbase/core";
import { escapeLike, isDefined, isNullOrFalse, isPlainObject } from "./utils.js";
import {
  allowPlainObjectFilter,
  FilterOperator,
  getColumnRules,
  isFilterObject,
  isNestedFilter,
  isRuleOperator,
} from "./rules.js";
import {
  ColumnTypeOf,
  FieldNamesOf,
  FilterCondition,
  FilterOf,
  ValueTypeOf,
  WhereExpressionOf,
} from "./base.js";

export class WhereBuilder {
  private _getFilterClause<
    T extends AnyColumn,
    TOperator extends FilterOperator,
    TValue extends FilterCondition<ValueTypeOf<T["__type"]>>[TOperator],
  >(column: T, value: TValue, operator: FilterOperator) {
    // TODO: handle dynamic columns filters, eg. guids

    switch (operator) {
      case "eq":
        return sql.eq(column, column.param(value));
      case "neq":
        return sql.ne(column, column.param(value));
      case "in":
        return Array.isArray(value)
          ? sql.in(
              column,
              value.map((v: ValueTypeOf<T["__type"]>) => column.param(v))
            )
          : sql.in(column, []);
      case "gt":
        return sql.gt(column, column.param(value));
      case "gte":
        return sql.gte(column, column.param(value));
      case "lt":
        return sql.lt(column, column.param(value));
      case "lte":
        return sql.lte(column, column.param(value));
      case "between":
        return sql.between(column, column.param(value[0]), column.param(value[1]));
      case "exists":
        return value ? sql.isNotNull(column) : sql.isNull(column);
      case "beginsWith":
        return sql.like(column, `${escapeLike(value)}%`);
      case "contains":
        return sql.like(column, `%${escapeLike(value)}%`);
      case "endsWith":
        return sql.like(column, `%${escapeLike(value)}`);
      default:
        throw new Error(`Unsupported filter operator: ${operator}`);
    }
  }

  private _getPastClause(
    node: SQLNode,
    key: OrderByEntry,
    value: string | null,
    projection: "after" | "before"
  ): SQLNode[] {
    const ascending = (key[1][0] === "asc") === (projection === "after");
    const nullable = isDefined(key[1][1]);

    if (value === null) {
      return ascending ? [] : [sql.isNotNull(node)];
    }

    if (!ascending) {
      return [sql.lt(node, value)];
    }

    return nullable ? [sql.gt(node, value), sql.isNull(node)] : [sql.gt(node, value)];
  }

  public buildColumnCondition<TTable extends AnyTable>(
    table: TTable,
    fieldName: FieldNamesOf<TTable>,
    condition: FilterOf<
      ColumnTypeOf<TTable, typeof fieldName>["runtimeType"],
      ValueTypeOf<ColumnTypeOf<TTable, typeof fieldName>>
    >
  ): SQLNode[] {
    if (!isDefined(condition)) {
      return [];
    }

    const column = table.getColumn(fieldName);

    if (!column) {
      throw new Error(`Unknown column: ${String(fieldName)}`);
    }

    const rules = getColumnRules(column);
    const subject = `${column.runtimeType} column "${fieldName}" of "${table.name}"`;

    if (!isFilterObject(condition)) {
      if (!rules.shorthand) {
        throw new Error(
          `Filter the ${subject} with one of its operators (${rules.operators.join(", ")}), ` +
            `not a bare value.`
        );
      }

      if (isPlainObject(condition) && !allowPlainObjectFilter(column)) {
        throw new Error(
          `Unknown operator ${Object.keys(condition)
            .map((key) => `"${key}"`)
            .join(", ")} in the filter on the ${subject} (valid: ${rules.operators.join(", ")}).`
        );
      }

      return [this._getFilterClause(column, condition, "eq")];
    }

    const clauses: SQLNode[] = [];

    for (const [operator, value] of Object.entries(condition)) {
      if (!isDefined(value)) {
        continue;
      }

      if (isNestedFilter(operator)) {
        throw new Error(`A nested \`where\` on the ${subject} is not supported yet.`);
      }

      if (!isRuleOperator(rules, operator)) {
        throw new Error(
          `Operator "${operator}" is not valid on the ${subject} ` +
            `(valid: ${rules.operators.join(", ")}).`
        );
      }

      clauses.push(this._getFilterClause(column, value, operator));
    }

    return clauses;
  }

  public build<TTable extends AnyTable>(
    table: TTable,
    where: WhereExpressionOf<TTable> | null | undefined
  ): SQLNode | undefined {
    if (!isDefined(where)) {
      return undefined;
    }

    const clauses: SQLNode[] = [];

    for (const [fieldName, condition] of Object.entries(where)) {
      if (isAndEntry(fieldName, condition) || isOrEntry(fieldName, condition)) {
        const children = condition.map((expr) => this.build(table, expr)).filter(isDefined);

        // TODO: Handle the case where the group is empty or matches every row.
        // An empty group constrains nothing; left in, it would render as `()`. Nor does an `or`
        // with a branch that matches every row (`{}`): dropping that branch would narrow it.
        // const everyRow = fieldName === "or" && children.length < condition.length;

        if (children.length) {
          clauses.push(sql.wrap(fieldName === "and" ? sql.and(children) : sql.or(children)));
        }

        continue;
      }

      if (isNotEntry(fieldName, condition)) {
        const shouldWrap = Object.values(condition).filter(isDefined).length > 1;
        const clause = this.build(table, condition);

        if (clause) {
          clauses.push(shouldWrap ? sql.wrap(sql.not(clause)) : sql.not(clause));
        }

        continue;
      }

      if (table.hasColumn(fieldName)) {
        clauses.push(
          ...this.buildColumnCondition(table, fieldName as FieldNamesOf<TTable>, condition)
        );
        continue;
      }

      // TODO: Maybe consider adding support for relations or computed fields here.

      throw new Error(`Unknown field name in where clause: ${fieldName}`);
    }

    return clauses.length > 0 ? sql.and(clauses) : undefined;
  }

  /**
   * The predicate selecting every row that sorts strictly after (or before) a cursor row, under
   * the total order `keys`.
   *
   * Expanded key by key — `k0 > $a OR (k0 = $a AND (k1 > $b OR ...))` — rather than written as a
   * row-value comparison, so mixed directions and nullable keys need no special case and nothing
   * depends on DSQL supporting `(a, b) > ($1, $2)`.
   *
   * `values` are the database's own text for each key, bound as bare parameters: the server
   * parses them against the column's type, so no codec may touch them. A codec that decodes to a
   * JS value can lose precision (a `Date` has milliseconds, a `timestamptz` microseconds), and a
   * cursor rebuilt from the lossy value skips rows. A `null` value is only valid for a nullable key.
   *
   * Per key, in the direction of travel (`before` reads every direction flipped, and flipping an
   * order also flips where its nulls sort, so the table holds for both bounds):
   *
   * | travelling | cursor value | strictly past it           | tied with it  |
   * | ---------- | ------------ | -------------------------- | ------------- |
   * | ascending  | `v`          | `k > v`, or `k IS NULL`\*  | `k = v`       |
   * | ascending  | `NULL`       | nothing (nulls are last)   | `k IS NULL`   |
   * | descending | `v`          | `k < v`                    | `k = v`       |
   * | descending | `NULL`       | `k IS NOT NULL`\*          | `k IS NULL`   |
   *
   * \* nullable keys only.
   */

  public buildKeyset(
    table: AnyTable,
    keyset: OrderByEntry[],
    values: (string | null)[],
    projection: "after" | "before"
  ) {
    if (keyset.length !== values.length) {
      throw new Error(
        `A keyset pairs every key with one value (got ${keyset.length} keys, ${values.length} values).`
      );
    }

    for (const [index, key] of keyset.entries()) {
      if (!key[1][1] && !isDefined(values[index])) {
        throw new Error(`Keyset value ${index} is null, but its key is not nullable.`);
      }
    }

    // Built from the last key outwards, so each level wraps the one after it. `inner` is the
    // predicate for the keys after this one; `undefined` means no row can satisfy it.
    let inner: SQLNode | undefined;
    let isOr = false;

    for (let index = keyset.length - 1; index >= 0; index--) {
      let node: SQLNode | undefined = table.getColumn(keyset[index][0]);

      if (!node) {
        node = sql.literal(keyset[index][0]);
      }

      const terms = this._getPastClause(node, keyset[index], values[index], projection);

      if (inner) {
        const tie = values[index] === null ? sql.isNull(node) : sql.eq(node, values[index]);

        // An `OR` below needs parentheses to keep its precedence inside this `AND`.
        const tied = sql.and([tie, isOr ? sql.wrap(inner) : inner]);

        // Alone, the tie needs none: it is an `AND` joining whatever `AND` sits above it.
        terms.push(terms.length > 0 ? sql.wrap(tied) : tied);
      }

      inner = terms.length === 0 ? undefined : terms.length === 1 ? terms[0] : sql.or(terms);
      isOr = terms.length > 1;
    }

    // Nothing can sort past the cursor — only possible when the last key is a nullable one read
    // ascending from a null. A primary key, which every page ends on, is never nullable.
    return inner ?? sql.raw("FALSE");
  }
}

export const isAndEntry = <T extends AnyTable>(
  fieldName: string,
  condition: WhereExpressionOf<T> | WhereExpressionOf<T>[] | null | undefined
): condition is WhereExpressionOf<T>[] => {
  return fieldName === "and" && !isNullOrFalse(condition) && Array.isArray(condition);
};

export const isOrEntry = <T extends AnyTable>(
  fieldName: string,
  condition: WhereExpressionOf<T> | WhereExpressionOf<T>[] | null | undefined
): condition is WhereExpressionOf<T>[] => {
  return fieldName === "or" && !isNullOrFalse(condition) && Array.isArray(condition);
};

export const isNotEntry = <T extends AnyTable>(
  fieldName: string,
  condition: WhereExpressionOf<T> | null | undefined
): condition is WhereExpressionOf<T> => {
  return (
    fieldName === "not" &&
    !isNullOrFalse(condition) &&
    typeof condition === "object" &&
    !Array.isArray(condition)
  );
};
