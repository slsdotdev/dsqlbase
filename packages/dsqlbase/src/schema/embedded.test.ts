import { describe, expect, it } from "vitest";
import { ColumnGroupDefinition } from "@dsqlbase/core/definition";
import { bigint } from "./columns/bigint.js";
import { text } from "./columns/text.js";
import { $enum } from "./domain.js";
import { embedded } from "./embedded.js";
import { table } from "./table.js";

const currency = $enum("currency", ["EUR", "USD"]);

const money = embedded({
  amount: bigint("amount").notNull(),
  currency: currency.column("currency").notNull(),
});

describe("embedded()", () => {
  it("places the object in a table as a group of prefixed columns", () => {
    const invoices = table("invoices", {
      id: text("id").primaryKey(),
      netValue: money.column("net_value"),
    });

    expect(invoices.columns.netValue).toBeInstanceOf(ColumnGroupDefinition);
    expect(invoices.toJSON().columns).toEqual([
      expect.objectContaining({ name: "id" }),
      expect.objectContaining({ name: "net_value_amount", dataType: "bigint", notNull: true }),
      expect.objectContaining({ name: "net_value_currency", domain: "currency", notNull: true }),
    ]);
  });

  it("encodes a group default through each member's codec", () => {
    const group = money.column("discount").default({ amount: 5n });

    expect(group.columns.amount.toJSON().defaultValue).toBe("'5'");
  });
});
