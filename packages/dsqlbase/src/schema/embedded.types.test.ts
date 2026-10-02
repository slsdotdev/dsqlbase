import { describe, expectTypeOf, it } from "vitest";
import { bigint } from "./columns/bigint.js";
import { text } from "./columns/text.js";
import { embedded } from "./embedded.js";
import { table } from "./table.js";

const geo = embedded({ lat: text("lat"), lng: text("lng") });
const address = embedded({ city: text("city").notNull(), geo: geo.column("geo") });
const money = embedded({ amount: bigint("amount").notNull() });

describe("embedded() types", () => {
  it("types a group default by its members' input types, nested groups included", () => {
    const billing = address.column("billing");

    expectTypeOf(billing.default).parameter(0).toEqualTypeOf<{
      city?: string;
      geo?: { lat?: string; lng?: string };
    }>();

    // @ts-expect-error -- a bigint member takes a bigint
    money.column("price").default({ amount: "5" });
  });

  it("hands a check callback nested refs", () => {
    const invoices = table("invoices", {
      id: text("id").primaryKey(),
      billing: address.column("billing"),
    });

    invoices.check((c) => {
      expectTypeOf(c.billing.geo.lat.name).toBeString();
      return c.billing.geo.lat;
    });

    // @ts-expect-error -- a group is not a column ref
    invoices.unique((c) => [c.billing]);
  });
});
