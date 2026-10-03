import { describe, expect, it } from "vitest";
import { ColumnValidationError } from "../utils/column-validation.js";
import { numeric } from "./numeric.js";

const write = (column: ReturnType<typeof numeric>, value: number) =>
  column["_validator"]?.write(value);

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
});
