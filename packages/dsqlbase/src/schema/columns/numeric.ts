import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";
import { ColumnValidationError } from "../utils/column-validation.js";

/**
 * An exact decimal value from a library such as decimal.js, big.js or bignumber.js. Its
 * `toString()` must print the value in a form Postgres reads as `numeric` — plain or exponent
 * notation.
 */
export type DecimalLike = {
  toString(): string;
  toJSON(): string;
};

/** A class that builds a {@link DecimalLike} from the database's decimal text. */
export type DecimalConstructor<T extends DecimalLike = DecimalLike> = new (value: string) => T;

/**
 * How a `numeric` value is presented: a JavaScript `number` (may lose precision), the exact
 * decimal text, or an instance of a decimal class.
 */
export type NumericMode = "number" | "string" | DecimalConstructor;

export type NumericOptions = {
  /** Total significant digits, 1–1000. @default 18 */
  precision?: number;
  /** Digits after the decimal point, 0–`precision`. @default 6, or 0 when `precision` is given */
  scale?: number;
  /**
   * How values are read:
   * - `"number"`: a JavaScript `number`. Values past ~15 significant digits lose precision.
   * - `"string"`: the exact decimal text, e.g. `"12.500000"`.
   * - a decimal class (`Decimal` from decimal.js, `Big`, `BigNumber`, …): an instance of it,
   *   built from the exact decimal text.
   *
   * In `"string"` and class modes a write also accepts a `number` or a decimal string.
   *
   * @default "number"
   */
  mode?: NumericMode;
};

/** What a read of a `numeric` column with options `O` returns. */
export type NumericValueType<O> = O extends { mode: "string" }
  ? string
  : O extends { mode: DecimalConstructor<infer T> }
    ? T
    : number;

/** What a write to a `numeric` column with options `O` accepts. */
export type NumericInputType<O> = O extends { mode: "string" }
  ? string | number
  : O extends { mode: DecimalConstructor<infer T> }
    ? T | string | number
    : number;

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
 * @param options Precision and scale; `{ precision }` alone means a scale of 0, as `numeric(p)`.
 * `mode` picks how values are read; see {@link NumericOptions.mode}.
 * @returns Serializable column definition for a numeric column.
 */
export function numeric<
  const TName extends string,
  const TOptions extends NumericOptions = NumericOptions,
>(name: TName, options: TOptions = {} as TOptions) {
  type TValue = NumericValueType<TOptions>;
  type TInput = NumericInputType<TOptions>;

  const precision = options.precision ?? DEFAULT_NUMERIC_PRECISION;
  const scale = options.scale ?? (options.precision === undefined ? DEFAULT_NUMERIC_SCALE : 0);
  const mode = options.mode ?? "number";

  if (!Number.isInteger(precision) || precision < 1 || precision > 1000) {
    throw new Error(`Column "${name}": numeric precision must be an integer from 1 to 1000.`);
  }

  if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
    throw new Error(`Column "${name}": numeric scale must be an integer from 0 to ${precision}.`);
  }

  const dataType = `numeric(${precision},${scale})`;

  const decode = (text: string): unknown => {
    if (mode === "number") return parseFloat(text);
    if (mode === "string") return text;
    return new mode(text);
  };

  /** A write value in the column's read form: a decimal string or number converted, if needed. */
  const toValue = (value: unknown): unknown => {
    if (mode === "number") return value;

    if (typeof value === "number" || typeof value === "string") {
      const text = String(value);

      if (!isNumericText(text)) {
        throw refusal(name, `${JSON.stringify(value)} is not a decimal number`);
      }

      return mode === "string" ? text : new mode(text);
    }

    return value;
  };

  return new ColumnDefinition<TName, ColumnConfig<TValue, string, "number", TInput>>(name, {
    dataType,
    runtimeType: "number",
    codec: {
      encode: (value) => String(value),
      decode: (value) => decode(value) as TValue,
    },
    validator: {
      write: (input) => {
        const value = toValue(input);
        const digits = decimalDigits(String(value));

        if (digits && digits.fraction > scale) {
          throw refusal(
            name,
            `${String(value)} has ${digits.fraction} decimal places; ${dataType} would round it`
          );
        }

        if (digits && digits.integer > precision - scale) {
          throw refusal(
            name,
            `${String(value)} has ${digits.integer} integer digits; ${dataType} allows at most ${precision - scale}`
          );
        }

        return value as TValue;
      },
      read: (value) => value,
    },
  });
}

const refusal = (column: string, message: string) =>
  new ColumnValidationError("invalid", column, "write", [{ message }]);

const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const SPECIAL_TEXT = /^([+-]?infinity|nan)$/i;

/** Whether Postgres reads `text` as a `numeric`: a decimal, exponent notation, `NaN`, `Infinity`. */
function isNumericText(text: string): boolean {
  return DECIMAL_TEXT.test(text) || SPECIAL_TEXT.test(text);
}

/**
 * How many integer and decimal digits a decimal text is written with, exponent notation
 * expanded — `1e-7` has 7 decimals. `null` for a value with no digits to count (`NaN`,
 * `Infinity`).
 */
function decimalDigits(text: string): { integer: number; fraction: number } | null {
  if (!DECIMAL_TEXT.test(text)) return null;

  const [mantissa = "0", exponentText = "0"] = text.replace(/^[+-]/, "").toLowerCase().split("e");
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
