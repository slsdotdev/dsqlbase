import { AnyColumn, AnyTable, sql, SQLNode } from "@dsqlbase/core";
import { escapeLike, isDefined, isNullOrFalse, isPlainObject } from "./utils.js";
import {
  allowPlainObjectFilter,
  FilterOperator,
  getFilterRules,
  isFilterObject,
  isNestedFilter,
  isRuleOperator,
} from "./operators.js";
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

    const rules = getFilterRules(column);
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
