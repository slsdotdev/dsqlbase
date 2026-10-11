import { describe, expect, it } from "vitest";
import { ColumnValidationError } from "../utils/column-validation.js";
import { numeric } from "./numeric.js";

type AnyNumeric = { _validator?: { write(value: unknown): unknown } };

const write = (column: unknown, value: unknown) => (column as AnyNumeric)._validator?.write(value);
const codec = (column: unknown) =>
  (column as { _codec: { encode(value: unknown): string; decode(text: string): unknown } })._codec;

/** A minimal decimal class, as decimal.js, big.js or bignumber.js would be passed. */
class Dec {
  constructor(readonly text: string) {}
  toString() {
    return this.text;
  }
  toJSON() {
    return this.text;
  }
}

/** More significant digits than a double holds: `parseFloat` rounds it. */
const EXACT = "12345678901234567.123456";

describe("numeric()", () => {
  it("defaults to numeric(18,6), DSQL's own default for a bare numeric", () => {
    expect(numeric("amount").toJSON().dataType).toBe("numeric(18,6)");
  });

  it("takes a precision and scale", () => {
    expect(numeric("amount", { precision: 38, scale: 10 }).toJSON().dataType).toBe(
      "numeric(38,10)"
    );
  });

  it("defaults the scale to 0 when only a precision is given, as numeric(p) does", () => {
    expect(numeric("count", { precision: 12 }).toJSON().dataType).toBe("numeric(12,0)");
  });

  it.each([
    [{ precision: 0 }],
    [{ precision: 1001 }],
    [{ precision: 10, scale: 11 }],
    [{ precision: 10, scale: -1 }],
    [{ precision: 10.5 }],
  ])("refuses an invalid precision or scale: %j", (options) => {
    expect(() => numeric("amount", options)).toThrow(/numeric/);
  });

  describe("write validation", () => {
    const amount = numeric("amount");

    it("accepts values that fit without rounding", () => {
      expect(write(amount, 999999999999)).toBe(999999999999);
      expect(write(amount, 0.123456)).toBe(0.123456);
      expect(write(amount, -0.000001)).toBe(-0.000001);
      expect(write(amount, 0)).toBe(0);
    });

    it("refuses a value with more decimals than the scale, which would be rounded", () => {
      expect(() => write(amount, 1.23456789)).toThrow(ColumnValidationError);
      expect(() => write(amount, 1.23456789)).toThrow(/8 decimal places.*numeric\(18,6\)/);
    });

    it("refuses a value with more integer digits than precision - scale, which would overflow", () => {
      expect(() => write(amount, 1234567890123)).toThrow(/13 integer digits.*at most 12/);
    });

    it("counts digits of values JavaScript prints in exponent notation", () => {
      expect(() => write(amount, 1e-7)).toThrow(/7 decimal places/);
      expect(() => write(amount, 1e21)).toThrow(/22 integer digits/);
      expect(write(numeric("tiny", { precision: 10, scale: 9 }), 5e-7)).toBe(5e-7);
    });

    it("validates a declared default", () => {
      expect(() => numeric("amount").default(1.23456789).toJSON()).toThrow(/decimal places/);
    });
  });

  describe("mode", () => {
    const wide = { precision: 38, scale: 6 } as const;

    it("reads a number by default, which loses digits past a double's precision", () => {
      expect(codec(numeric("amount", wide)).decode(EXACT)).toBe(parseFloat(EXACT));
      expect(codec(numeric("amount", wide)).decode(EXACT)).not.toBe(EXACT);
    });

    it('reads the exact decimal text in "string" mode', () => {
      expect(codec(numeric("amount", { ...wide, mode: "string" })).decode(EXACT)).toBe(EXACT);
    });

    it("reads an instance of the decimal class it is given, built from the exact text", () => {
      const value = codec(numeric("amount", { ...wide, mode: Dec })).decode(EXACT);

      expect(value).toBeInstanceOf(Dec);
      expect((value as Dec | undefined)?.text).toBe(EXACT);
    });

    it("encodes every mode as decimal text", () => {
      expect(codec(numeric("amount")).encode(1.5)).toBe("1.5");
      expect(codec(numeric("amount", { mode: "string" })).encode("1.5")).toBe("1.5");
      expect(codec(numeric("amount", { mode: Dec })).encode(new Dec("1.5"))).toBe("1.5");
    });

    it('takes a string or a number on write in "string" mode, and stores the text', () => {
      const amount = numeric("amount", { ...wide, mode: "string" });

      expect(write(amount, EXACT)).toBe(EXACT);
      expect(write(amount, 1.5)).toBe("1.5");
    });

    it("takes an instance, a string or a number on write in class mode, and stores an instance", () => {
      const amount = numeric("amount", { ...wide, mode: Dec });
      const value = new Dec("1.5");

      expect(write(amount, value)).toBe(value);
      expect((write(amount, EXACT) as Dec | undefined)?.text).toBe(EXACT);
      expect((write(amount, 2) as Dec | undefined)?.text).toBe("2");
    });

    it("refuses a string that is not a decimal number", () => {
      expect(() => write(numeric("amount", { mode: "string" }), "12abc")).toThrow(
        /"12abc" is not a decimal number/
      );
      expect(() => write(numeric("amount", { mode: Dec }), "")).toThrow(/not a decimal number/);
    });

    it("accepts NaN and Infinity as text, as number mode does", () => {
      expect(write(numeric("amount", { mode: "string" }), "NaN")).toBe("NaN");
      expect(write(numeric("amount", { mode: "string" }), "-Infinity")).toBe("-Infinity");
    });

    it("refuses a value that would be rounded or overflow, in every mode", () => {
      const asString = numeric("amount", { mode: "string" });
      const asClass = numeric("amount", { mode: Dec });

      expect(() => write(asString, "1.23456789")).toThrow(/8 decimal places/);
      expect(() => write(asString, "-1234567890123")).toThrow(/13 integer digits/);
      expect(() => write(asClass, new Dec("1.23456789"))).toThrow(/8 decimal places/);
      expect(() => write(asClass, new Dec("1e-7"))).toThrow(/7 decimal places/);
      expect(() => write(asClass, new Dec("1.5E+12"))).toThrow(/13 integer digits/);
      expect(write(asString, "000123.450000")).toBe("000123.450000");
    });

    it("validates a declared default in the column's mode", () => {
      expect(() => numeric("amount", { mode: "string" }).default("1.23456789").toJSON()).toThrow(
        /decimal places/
      );
      expect(numeric("amount", { mode: Dec }).default("1.5").toJSON().defaultValue).toBeDefined();
    });
  });
});
