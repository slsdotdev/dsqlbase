import { describe, expectTypeOf, it } from "vitest";
import type { InputTypeOf, ValueTypeOf } from "../../client/model/base.js";
import type { ColumnFilterOf } from "../../client/model/filters.js";
import type { ColumnConfig } from "@dsqlbase/core";
import { numeric } from "./numeric.js";

/**
 * Shaped like decimal.js's `Decimal`: the constructor takes more than a string, and instances
 * carry their own methods beside `toString()` / `toJSON()`.
 */
class Decimal {
  constructor(readonly value: string | number | Decimal) {}
  plus(other: Decimal | number): Decimal {
    return new Decimal(Number(this.value) + Number(other));
  }
  toString(): string {
    return String(this.value);
  }
  toJSON(): string {
    return this.toString();
  }
}

/** A column's read and write types, as a model types them. */
const typesOf = <T extends ColumnConfig>(column: { __type: T }) => ({
  column,
  read: expectTypeOf<ValueTypeOf<T>>(),
  write: expectTypeOf<InputTypeOf<T>>(),
  filter: (filter: ColumnFilterOf<T>) => filter,
});

describe("numeric() types", () => {
  it("reads and writes a number by default", () => {
    const { read, write } = typesOf(numeric("amount").notNull());

    read.toEqualTypeOf<number>();
    write.toEqualTypeOf<number>();
  });

  it('reads a string in "string" mode, and writes a string or a number', () => {
    const { read, write } = typesOf(numeric("amount", { mode: "string" }).notNull());

    read.toEqualTypeOf<string>();
    write.toEqualTypeOf<string | number>();
  });

  it("reads an instance of a decimal class, and writes it, a string or a number", () => {
    const { read, write } = typesOf(
      numeric("amount", { precision: 38, scale: 10, mode: Decimal }).notNull()
    );

    read.toEqualTypeOf<Decimal>();
    write.toEqualTypeOf<Decimal | string | number>();
    expectTypeOf(numeric("amount", { mode: Decimal }).default)
      .parameter(0)
      .toEqualTypeOf<Decimal | string | number>();
  });

  it("filters by the read type, with comparison operators", () => {
    const { filter } = typesOf(numeric("amount", { mode: Decimal }).notNull());

    filter(new Decimal(1));
    filter({ gt: new Decimal(1), lte: new Decimal(2) });
    // @ts-expect-error -- a number column has no pattern operators
    filter({ contains: "1" });
  });

  it("refuses a mode that is not a decimal class", () => {
    numeric("amount", {
      // @ts-expect-error -- a class without toJSON is not DecimalLike
      mode: class {
        constructor(readonly v: string) {}
      },
    });
  });
});
