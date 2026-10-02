# Embedded objects

_Audience: application developers using `dsqlbase`._

An embedded object is a reusable value object — `Money`, `Address` — stored as real columns of
the table that embeds it, and read and written as one nested object. Declaring one is covered in
[Schema](./schema.md#embedded-objects); this page is about using it.

```ts
export const money = embedded({
  amount: bigint("amount").notNull(),
  currency: currency.column("currency").notNull().default("EUR"),
});

export const geo = embedded({ lat: numeric("lat"), lng: numeric("lng") });
export const address = embedded({ city: text("city"), geo: geo.column("geo") });

export const invoices = table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  netValue: money.column("net_value"), // net_value_amount, net_value_currency
  billing: address.column("billing"), // billing_city, billing_geo_lat, billing_geo_lng
});
```

## Why columns, not a document

A member is an ordinary column, so it can be indexed, constrained, filtered and ordered like any
other — DSQL cannot index a `jsonb` document, and has no composite types. Use
[`jsonb()`](./schema.md#json-columns) for a document whose shape you only read and write whole.

## When a group is `null`

A group has no nullability of its own; its members decide it:

- A member's `.notNull()` is its column's `NOT NULL`, so a group with a required member is
  always present — `invoice.netValue` above is never `null`.
- A group whose members are all nullable, nested groups included, can be absent. It reads as
  `null` exactly when every one of its columns is `NULL`; `invoice.billing` is
  `{ city, geo } | null`, and `geo` within it the same.

## Reading

A group is read as one object. In `select`, it takes `true` for every member, or a map naming
some — a nested group takes `true` or a map in turn:

```ts
const invoice = await dsql.invoices.findOne({
  where: { id },
  select: { netValue: true, billing: { city: true, geo: { lat: true } } },
});

invoice.netValue; // { amount: 120n, currency: "EUR" }
invoice.billing; // { city: "Cluj", geo: { lat: 46.77 } | null } | null
```

- No `select` reads every group whole, as it reads every column.
- A write's `return` takes the same maps.
- Each member is decoded and validated by its own column, exactly as a plain column would be.
- A nullable group reads all of its columns whatever the map names — telling an absent group
  from one whose selected members happen to be `NULL` needs every column — and returns only the
  members named. `distinct` compares those extra columns too.
- A map naming a member the group does not have, or giving a column a map, throws.

## Filtering and ordering

A group is filtered through two operators of its own: `exists`, and the nested `where` over its
members. Members are named only inside `where` — never beside `exists` — so a member called
`exists` or `eq` is never mistaken for an operator.

```ts
await dsql.invoices.findMany({
  where: {
    netValue: { where: { amount: { gt: 100n }, currency: "EUR" } },
    billing: {
      exists: true,
      where: { or: [{ city: "Cluj" }, { geo: { where: { lat: { gte: 44, lte: 45 } } } }] },
    },
  },
  orderBy: { netValue: { amount: "desc" }, billing: { geo: { lat: "asc" } } },
});
```

- **`where`** takes the same language as a table's: each member's operators, by its own column
  type and encoded by its own codec, `and` / `or` / `not`, and nested groups in turn.
- **`exists: true`** matches a present group — any of its columns set; **`exists: false`** an
  absent one — every column `NULL`. It is the same rule a read uses to return `null`, so the two
  never disagree.
- A group takes nothing else: a bare value, a member beside `where`, or another operator throws.
- **`orderBy`** orders by members, through a nested object; a group has no direction of its own.
  A member that cannot be ordered — a JSON column — is refused as it would be at table level.
- **`paginate`** takes member keys the same way; the cursor records them by field path.

## Related

- [Schema](./schema.md#embedded-objects) — declaring objects and placing them as groups
- [Querying](./querying.md)
