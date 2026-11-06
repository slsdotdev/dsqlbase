/**
 * Checks a column's values on their way into and out of the database. Writes run `write` before
 * the codec encodes; reads run `read` after it decodes. Filters run neither: a filter value is a
 * pattern to compare with, not a value to store. Either method throws to refuse a value.
 *
 * `write` takes what a write accepts (`TInput`) and returns what is stored (`TValue`); they
 * differ for a column whose writes accept more than its reads return — a JSON column validated
 * by a schema with defaults, for one.
 */
export type ColumnValidator<TValue, TInput = TValue> = {
  write(input: TInput): TValue;
  read(value: TValue): TValue;
};
