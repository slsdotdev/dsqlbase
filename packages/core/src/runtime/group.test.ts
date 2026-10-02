import { describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  EmbeddedObjectDefinition,
  TableDefinition,
} from "../definition/index.js";
import { Column } from "./column.js";
import { ColumnGroup, GroupSelection } from "./group.js";
import { Table } from "./table.js";

const money = new EmbeddedObjectDefinition({
  amount: new ColumnDefinition("amount", {
    codec: { encode: (value: number) => String(value), decode: (raw: string) => Number(raw) },
  }).notNull(),
  currency: new ColumnDefinition("currency").notNull(),
});

const geo = new EmbeddedObjectDefinition({
  lat: new ColumnDefinition("lat"),
  lng: new ColumnDefinition("lng"),
});

const address = new EmbeddedObjectDefinition({
  city: new ColumnDefinition("city"),
  zip: new ColumnDefinition("zip"),
  geo: geo.column("geo"),
});

const invoices = new Table(
  new TableDefinition("invoices", {
    columns: {
      id: new ColumnDefinition("id").primaryKey(),
      netValue: money.column("net_value"),
      billing: address.column("billing"),
    },
  })
);

const netValue = invoices.columns.netValue as ColumnGroup<string, never, typeof invoices>;
const billing = invoices.columns.billing as ColumnGroup<string, never, typeof invoices>;
const billingGeo = billing.columns.geo as ColumnGroup<string, never, typeof invoices>;

const names = (columns: { name: string }[]) => columns.map((column) => column.name);

describe("ColumnGroup", () => {
  it("builds its members as columns and groups of the table", () => {
    expect(netValue).toBeInstanceOf(ColumnGroup);
    expect(netValue.name).toBe("net_value");
    expect(netValue.getColumn("amount")).toBeInstanceOf(Column);
    expect(netValue.getColumn("amount")?.table).toBe(invoices);
    expect(billing.getColumn("geo")).toBeInstanceOf(ColumnGroup);
    expect(billing.getColumn("nope")).toBeUndefined();
  });

  it("is nullable only when every member, nested groups included, is", () => {
    expect(netValue.nullable).toBe(false);
    expect(billing.nullable).toBe(true);
    expect(billingGeo.nullable).toBe(true);
  });

  it("lists its columns depth first", () => {
    expect(names(billing.leafColumns())).toEqual([
      "billing_city",
      "billing_zip",
      "billing_geo_lat",
      "billing_geo_lng",
    ]);
  });
});

describe("ColumnGroup.reader", () => {
  const row = {
    net_value_amount: "120",
    net_value_currency: "EUR",
    billing_city: "Cluj",
    billing_zip: null,
    billing_geo_lat: null,
    billing_geo_lng: null,
  };

  it("reads every member, decoded by its column, with no selection", () => {
    const reader = netValue.reader();

    expect(names(reader.columns)).toEqual(["net_value_amount", "net_value_currency"]);
    expect(reader.resolve(row)).toEqual({ amount: 120, currency: "EUR" });
  });

  it("emits only the selected members of a group that is never null", () => {
    const amount = netValue.getColumn("amount") as Column<string, never, typeof invoices>;
    const reader = netValue.reader([["amount", amount]]);

    expect(names(reader.columns)).toEqual(["net_value_amount"]);
    expect(reader.resolve(row)).toEqual({ amount: 120 });
  });

  it("projects every column of a nullable group to tell whether it is present", () => {
    const zip = billing.getColumn("zip") as Column<string, never, typeof invoices>;
    const reader = billing.reader([["zip", zip]]);

    expect(names(reader.columns)).toEqual([
      "billing_zip",
      "billing_city",
      "billing_geo_lat",
      "billing_geo_lng",
    ]);
    // Present through `city`, though the selected `zip` is null.
    expect(reader.resolve(row)).toEqual({ zip: null });
  });

  it("reads a nullable group as null when every column is", () => {
    const empty = {
      billing_city: null,
      billing_zip: null,
      billing_geo_lat: null,
      billing_geo_lng: null,
    };

    expect(billing.reader().resolve(empty)).toBeNull();
  });

  it("resolves a nested group inside out", () => {
    expect(billing.reader().resolve(row)).toEqual({ city: "Cluj", zip: null, geo: null });
    expect(billing.reader().resolve({ ...row, billing_geo_lat: "46.7" })).toEqual({
      city: "Cluj",
      zip: null,
      geo: { lat: "46.7", lng: null },
    });
  });

  it("reads a nested group through its own selection", () => {
    const selection: GroupSelection = [
      ["geo", billingGeo, [["lng", billingGeo.getColumn("lng") as Column<string, never, never>]]],
    ];

    expect(billing.reader(selection).resolve({ ...row, billing_geo_lng: "23.6" })).toEqual({
      geo: { lng: "23.6" },
    });
  });

  it("refuses a member that is not its own", () => {
    const other = invoices.columns.id as unknown as Column<string, never, typeof invoices>;

    expect(() => netValue.reader([["amount", other]])).toThrow(/no member "amount"/);
  });
});
