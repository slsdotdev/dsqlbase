import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";
import { ColumnValidationError } from "../utils/column-validation.js";

export type NumericOptions = {
  /** Total significant digits, 1–1000. @default 18 */
  precision?: number;
  /** Digits after the decimal point, 0–`precision`. @default 6, or 0 when `precision` is given */
  scale?: number;
};

/**
 * DSQL's own precision and scale for a `numeric` declared without them, stated explicitly so
 * Postgres and PGlite store the same type.
 */
export const DEFAULT_NUMERIC_PRECISION = 18;
export const DEFAULT_NUMERIC_SCALE = 6;

/**
 * Defines a `numeric(precision, scale)` (exact decimal) column in the database schema.
 *
 * Without options the column is `numeric(18,6)`, which is what DSQL makes of a bare `numeric`:
 * at most 12 integer digits and 6 decimals. A write that would not fit — more decimals than the
 * scale, which the database would round, or more integer digits than `precision - scale`, which
 * it would refuse — throws a {@link ColumnValidationError} instead.
 *
 * @param name Column name in database
 * @param options Precision and scale; `{ precision }` alone means a scale of 0, as `numeric(p)`
 * @returns Serializable column definition for a numeric column.
 */
export function numeric<const TName extends string>(name: TName, options: NumericOptions = {}) {
  const precision = options.precision ?? DEFAULT_NUMERIC_PRECISION;
  const scale = options.scale ?? (options.precision === undefined ? DEFAULT_NUMERIC_SCALE : 0);

  if (!Number.isInteger(precision) || precision < 1 || precision > 1000) {
    throw new Error(`Column "${name}": numeric precision must be an integer from 1 to 1000.`);
  }

  if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
    throw new Error(`Column "${name}": numeric scale must be an integer from 0 to ${precision}.`);
  }

  const dataType = `numeric(${precision},${scale})`;

  return new ColumnDefinition<TName, ColumnConfig<number, string, "number">>(name, {
    dataType,
    runtimeType: "number",
    codec: {
      encode: (value) => value.toString(),
      decode: (value) => parseFloat(value),
    },
    validator: {
      write: (value) => {
        const digits = decimalDigits(value);

        if (digits && digits.fraction > scale) {
          throw refusal(
            name,
            `${value} has ${digits.fraction} decimal places; ${dataType} would round it`
          );
        }

        if (digits && digits.integer > precision - scale) {
          throw refusal(
            name,
            `${value} has ${digits.integer} integer digits; ${dataType} allows at most ${precision - scale}`
          );
        }

        return value;
      },
      read: (value) => value,
    },
  });
}

const refusal = (column: string, message: string) =>
  new ColumnValidationError("invalid", column, "write", [{ message }]);

/**
 * How many integer and decimal digits a number is written with, exponent notation expanded —
 * `1e-7` has 7 decimals. `null` for a value with no digits to count (`NaN`, `Infinity`).
 */
function decimalDigits(value: number): { integer: number; fraction: number } | null {
  if (!Number.isFinite(value)) return null;

  const [mantissa = "0", exponentText = "0"] = Math.abs(value).toString().split("e");
  const [whole = "", decimals = ""] = mantissa.split(".");
  const exponent = Number(exponentText);
  const digits = whole + decimals;
  // Where the decimal point falls in `digits` once the exponent is applied.
  const point = whole.length + exponent;

  const integerPart = point > 0 ? digits.slice(0, point).padEnd(point, "0") : "";
  const fractionPart = point >= 0 ? digits.slice(point) : "0".repeat(-point) + digits;

  return {
    integer: integerPart.replace(/^0+/, "").length,
    fraction: fractionPart.replace(/0+$/, "").length,
  };
}

export { numeric as decimal };
