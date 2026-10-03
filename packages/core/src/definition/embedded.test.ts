import { describe, expect, it } from "vitest";

import { sql } from "../sql/tag.js";
import { ColumnDefinition, ColumnIdentityConfig } from "./column.js";
import { ColumnGroupDefinition, EmbeddedObjectDefinition, columnEntries } from "./embedded.js";
import { TableDefinition } from "./table.js";
import { UnionDefinition } from "./union.js";

const money = () =>
  new EmbeddedObjectDefinition({
    amount: new ColumnDefinition("amount", { dataType: "bigint" }).notNull(),
    currency: new ColumnDefinition("currency").notNull(),
  });

const geo = new EmbeddedObjectDefinition({
  lat: new ColumnDefinition("lat", { dataType: "numeric" }),
  lng: new ColumnDefinition("lng", { dataType: "numeric" }),
});

const address = new EmbeddedObjectDefinition({
  city: new ColumnDefinition("city"),
  geo: geo.column("geo"),
});

describe("EmbeddedObjectDefinition", () => {
  it("names each member column <group>_<member>", () => {
    const group = money().column("net_value");

    expect(group).toBeInstanceOf(ColumnGroupDefinition);
    expect(group.name).toBe("net_value");
    expect(group.columns.amount.name).toBe("net_value_amount");
    expect(group.columns.currency.name).toBe("net_value_currency");
  });

  it("chains the prefix through a nested group", () => {
    const billing = address.column("billing");

    expect(billing.columns.geo.name).toBe("billing_geo");
    expect(billing.columns.geo.columns.lat.name).toBe("billing_geo_lat");
    expect(columnEntries(billing.columns).map(([path, column]) => [path, column.name])).toEqual([
      [["city"], "billing_city"],
      [["geo", "lat"], "billing_geo_lat"],
      [["geo", "lng"], "billing_geo_lng"],
    ]);
  });

  it("copies the members, so two groups and the object never share one", () => {
    const shape = money();
    const first = shape.column("first");
    const second = shape.column("second");

    first.columns.amount.unique();

    expect(first.columns.amount).not.toBe(shape.columns.amount);
    expect(second.columns.amount.toJSON().unique).toBe(false);
    expect(shape.columns.amount.toJSON()).toMatchObject({ name: "amount", unique: false });
  });

  it("keeps each member's own nullability and settings", () => {
    const group = money().column("price");

    expect(group.columns.amount.toJSON()).toMatchObject({
      name: "price_amount",
      dataType: "bigint",
      notNull: true,
    });
    expect(address.column("billing").columns.city.toJSON().notNull).toBe(false);
  });

  it("copies an identity config rather than sharing it", () => {
    const options = { dataType: "bigint", cache: 1, cycle: false, increment: 1 };
    const counters = new EmbeddedObjectDefinition({
      seq: new ColumnDefinition("seq", {
        identity: { type: "ALWAYS", sequenceName: "seq_seq", options },
      }),
    });

    const first = counters.column("first");
    const second = counters.column("second");
    const identity = first.columns.seq["_identity"] as ColumnIdentityConfig;
    identity.sequenceName = "changed";
    identity.options.increment = 5;

    expect(second.columns.seq.toJSON().identity).toMatchObject({
      sequenceName: "seq_seq",
      options: { increment: 1 },
    });
  });

  it("rebuilds a member's check against its prefixed name, and prefixes an explicit name", () => {
    const shape = new EmbeddedObjectDefinition({
      amount: new ColumnDefinition("amount").check((self) => sql`${self} >= 0`),
      fee: new ColumnDefinition("fee").check((self) => sql`${self} < 10`, "fee_cap"),
    });

    const group = shape.column("net");

    expect(group.columns.amount.toJSON().check).toMatchObject({
      name: "net_amount_check",
      expression: '"net_amount" >= 0',
    });
    expect(group.columns.fee.toJSON().check).toMatchObject({
      name: "net_fee_cap",
      expression: '"net_fee" < 10',
    });
  });

  it("refuses a primary key member", () => {
    expect(
      () => new EmbeddedObjectDefinition({ id: new ColumnDefinition("id").primaryKey() })
    ).toThrow(/primary key/);
  });

  it("refuses a tenant claim member", () => {
    expect(
      () =>
        new EmbeddedObjectDefinition({
          tenant: new ColumnDefinition("tenant", { tenantKey: true, readOnly: true }).notNull(),
        })
    ).toThrow(/tenant claim/);
  });

  it("refuses a reserved member name", () => {
    expect(() => new EmbeddedObjectDefinition({ $$meta: new ColumnDefinition("meta") })).toThrow(
      /reserved/
    );
  });
});

describe("ColumnGroupDefinition.default", () => {
  it("sets each named member's default, nested groups included", () => {
    const billing = address.column("billing").default({ city: "-", geo: { lat: "0" } });

    expect(billing.columns.city.toJSON().defaultValue).toBe("'-'");
    expect(billing.columns.geo.columns.lat.toJSON().defaultValue).toBe("'0'");
    expect(billing.columns.geo.columns.lng.toJSON().defaultValue).toBeNull();
  });

  it("carries a nested group's own default into every placement", () => {
    const located = new EmbeddedObjectDefinition({
      geo: geo.column("geo").default({ lat: "1" }),
    });

    expect(located.column("home").columns.geo.columns.lat.toJSON()).toMatchObject({
      name: "home_geo_lat",
      defaultValue: "'1'",
    });
  });

  it("refuses a member the group does not have", () => {
    expect(() =>
      money()
        .column("net")
        .default({ nope: 1 } as never)
    ).toThrow(/no member "nope"/);
  });
});

describe("a table with column groups", () => {
  const invoices = () =>
    new TableDefinition("invoices", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
        netValue: money().column("net_value"),
        billing: address.column("billing"),
      },
    });

  it("serializes every member as a plain column, in declaration order", () => {
    expect(
      invoices()
        .toJSON()
        .columns.map((column) => column.name)
    ).toEqual([
      "id",
      "net_value_amount",
      "net_value_currency",
      "billing_city",
      "billing_geo_lat",
      "billing_geo_lng",
    ]);
  });

  it("hands the check, unique and index callbacks nested refs", () => {
    const table = invoices();

    table.check((c) => sql`${c.netValue.amount} >= 0`, "positive");
    table.unique((c) => [c.netValue.currency, c.billing.geo.lat]);
    table.index("invoices_lat_idx").columns((c) => [c.billing.geo.lat, c.id]);

    const json = table.toJSON();

    expect(json.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "positive", expression: '"net_value_amount" >= 0' }),
        expect.objectContaining({ columns: ["net_value_currency", "billing_geo_lat"] }),
      ])
    );
    expect(json.indexes[0]?.columns.map((column) => column.column)).toEqual([
      "billing_geo_lat",
      "id",
    ]);
  });

  it("refuses a member whose column name another field already uses", () => {
    expect(
      () =>
        new TableDefinition("invoices", {
          columns: {
            netValue: money().column("net_value"),
            amount: new ColumnDefinition("net_value_amount"),
          },
        })
    ).toThrow(/fields "netValue.amount" and "amount"/);
  });

  it("refuses a primary key constraint on a member", () => {
    expect(() => invoices().primaryKey((c) => [c.netValue.amount])).toThrow(
      /member of an embedded object/
    );
  });

  it("does not share a group across a union", () => {
    const priced = (name: string) =>
      new TableDefinition(name, {
        columns: { id: new ColumnDefinition("id").primaryKey(), price: money().column("price") },
      });

    const union = new UnionDefinition({ a: priced("a"), b: priced("b") });

    expect(Object.keys(union.columns)).toEqual(["id"]);
  });
});

describe("EmbeddedObjectDefinition — renames and deprecation", () => {
  const table = (
    columns: Record<
      string,
      ColumnDefinition<string, never> | ColumnGroupDefinition<string, never, boolean>
    >
  ) =>
    new TableDefinition("products", {
      columns: { id: new ColumnDefinition("id").primaryKey(), ...columns } as never,
    });

  it("prefixes a member's previous name with the group, as its column name is", () => {
    const money = new EmbeddedObjectDefinition({
      amount: new ColumnDefinition("amount").renamedFrom("value"),
    });

    const json = table({ price: money.column("price") }).toJSON();

    expect(json.columns.find((c) => c.name === "price_amount")?.renamedFrom).toBe("price_value");
  });

  it("refuses deprecating a member: the client reads a group as a whole", () => {
    const money = new EmbeddedObjectDefinition({
      amount: new ColumnDefinition("amount").deprecated(),
    });

    expect(() => table({ price: money.column("price") })).toThrow(
      /deprecates "price.amount", a member of an embedded object/
    );
  });
});
