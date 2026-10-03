import { beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnDefinition, type Session, type SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import type { StandardSchemaV1 } from "../../schema/utils/standard-schema.js";
import { encodeGlobalId } from "../../schema/utils/global-id.js";
import {
  array,
  belongsTo,
  bigint,
  boolean,
  bytea,
  date,
  datetime,
  duration,
  embedded,
  guid,
  int,
  interval,
  json,
  jsonb,
  numeric,
  record,
  relations,
  table,
  text,
  union,
  uuid,
} from "../../schema/index.js";

// Refuses anything but a full `{ theme }`, so a filter value it validated would throw.
const prefsSchema: StandardSchemaV1<{ theme: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) =>
      typeof (value as { theme?: unknown }).theme === "string"
        ? { value: value as { theme: string } }
        : { issues: [{ message: "theme is required" }] },
  },
};

const docs = table("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  pages: int("pages"),
  draft: boolean("draft"),
  body: bytea("body"),
  settings: json("settings"),
  doc: jsonb("doc"),
  prefs: jsonb("prefs").schema(prefsSchema),
  tags: array("tags"),
  limits: record("limits"),
  ttl: interval("ttl"),
});

const notes = table("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  settings: json("settings"),
});

const items = union({ docs, notes });

const schema = { docs, notes, items };

/**
 * Filters, `orderBy` and `distinct` follow the column's runtime type (`filters.ts`). The
 * calls the types refuse are cast through `any`: they test the runtime, which enforces the same
 * rules for a caller the types cannot see — a resolver passing arguments through.
 */
describe("filters by runtime type", () => {
  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<typeof schema>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loose: any;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
    loose = dsql;
  });

  const where = async (filter: object) => {
    await loose.docs.findMany({ select: { id: true }, where: filter });

    return calls.at(-1)?.text.replace(/^.* WHERE /, "");
  };

  describe("operators", () => {
    it("applies every operator of one column's filter, AND-ed", async () => {
      expect(await where({ pages: { gte: 1, lte: 5 } })).toBe(
        '"__t0"."pages" >= $1 AND "__t0"."pages" <= $2'
      );
    });

    it("keeps the pattern operators on string columns", async () => {
      expect(await where({ title: { contains: "x" } })).toBe('"__t0"."title" LIKE $1');
    });

    it("skips an operator set to undefined", async () => {
      expect(await where({ pages: { gt: undefined, lt: 3 } })).toBe('"__t0"."pages" < $1');
    });

    it("refuses an operator the column's runtime type does not have", async () => {
      await expect(where({ id: { contains: "x" } })).rejects.toThrow(
        'Operator "contains" is not valid on the uuid column "id" of "docs" ' +
          "(valid: eq, neq, in, gt, gte, lt, lte, between, exists)."
      );
      await expect(where({ draft: { gt: true } })).rejects.toThrow(
        'Operator "gt" is not valid on the boolean column "draft"'
      );
      expect(calls).toHaveLength(0);
    });

    it("refuses an operator no runtime type has", async () => {
      await expect(where({ pages: { eq: 1, near: 2 } })).rejects.toThrow(
        'Unknown operator "near" in the filter on the number column "pages" of "docs".'
      );
    });

    // An object naming no operator is a value only where values can be plain objects.
    it("refuses an object that names only unknown operators, where it can't be a value", async () => {
      await expect(where({ id: { isNull: true } })).rejects.toThrow(
        'Unknown operator "isNull" in the filter on the uuid column "id" of "docs" ' +
          "(valid: eq, neq, in, gt, gte, lt, lte, between, exists)."
      );
      expect(calls).toHaveLength(0);
    });

    // An interval's value is a `Duration`, itself a plain object.
    it("keeps an object with no operator as a value on an interval column", async () => {
      expect(await where({ ttl: { days: 1 } })).toBe('"__t0"."ttl" = $1');
    });

    it("escapes LIKE wildcards in a pattern operator's value", async () => {
      await where({ title: { beginsWith: "50%_off\\" } });
      expect(calls.at(-1)?.params).toEqual(["50\\%\\_off\\\\%"]);

      await where({ title: { contains: "a_b" } });
      expect(calls.at(-1)?.params).toEqual(["%a\\_b%"]);
    });

    it("renders in: [] as matching nothing", async () => {
      expect(await where({ pages: { in: [] } })).toBe("FALSE");
    });

    // `{}` matches every row, so an `or` holding it does too: no condition at all.
    it("drops an or with a branch that matches every row", async () => {
      await where({ or: [{}, { pages: { eq: 1 } }] });
      expect(calls.at(-1)?.text).not.toContain("WHERE");
    });

    it("reserves `where` for filtering into a value", async () => {
      await expect(where({ settings: { where: { theme: { eq: "dark" } } } })).rejects.toThrow(
        'A nested `where` on the json column "settings" of "docs" is not supported yet.'
      );
    });
  });

  describe("value shorthand", () => {
    it("means eq where the runtime type takes one", async () => {
      expect(await where({ title: "a" })).toBe('"__t0"."title" = $1');
    });

    it("takes a plain-object value that names no operator, as an interval's Duration", async () => {
      expect(await where({ ttl: { hours: 1 } })).toBe('"__t0"."ttl" = $1');
    });

    it.each([
      ["json", { settings: { theme: "dark" } }, "settings"],
      ["json", { settings: "dark" }, "settings"],
      ["bytes", { body: new Uint8Array([1]) }, "body"],
    ])("is refused on a %s column", async (runtimeType, filter, field) => {
      await expect(where(filter)).rejects.toThrow(
        `Filter the ${runtimeType} column "${field}" of "docs" with one of its operators ` +
          "(exists), not a bare value."
      );
    });

    it.each([
      ["array", { tags: ["a"] }, "tags", "eq, neq, contains, exists"],
      ["object", { limits: { cpu: 1 } }, "limits", "eq, neq, contains, exists, hasKey"],
    ])("is refused on an %s column", async (runtimeType, filter, field, operators) => {
      await expect(where(filter)).rejects.toThrow(
        `Filter the ${runtimeType} column "${field}" of "docs" with one of its operators ` +
          `(${operators}), not a bare value.`
      );
    });
  });

  describe("json columns", () => {
    it("filter by exists", async () => {
      expect(await where({ settings: { exists: true } })).toBe('"__t0"."settings" IS NOT NULL');
      expect(await where({ settings: { exists: false } })).toBe('"__t0"."settings" IS NULL');
    });

    it.each(["eq", "contains", "beginsWith", "gt"])("refuse %s", async (operator) => {
      await expect(where({ settings: { [operator]: "x" } })).rejects.toThrow(
        `Operator "${operator}" is not valid on the json column "settings" of "docs" ` +
          "(valid: exists)."
      );
    });

    it("are refused inside and / or / not, as at the top", async () => {
      await expect(where({ or: [{ settings: { eq: "x" } }] })).rejects.toThrow(
        'Operator "eq" is not valid on the json column "settings"'
      );
    });

    it("cannot be ordered by", async () => {
      expect(() => loose.docs.findMany({ orderBy: { settings: "asc" } })).toThrow(
        'Cannot order by the json column "settings" of "docs".'
      );
      expect(() => loose.docs.paginate({ orderBy: { body: "asc" } })).toThrow(
        'Cannot order by the bytes column "body" of "docs".'
      );
    });

    it("cannot be compared by distinct, selected or implied", () => {
      expect(() => loose.docs.findMany({ distinct: true })).toThrow(
        '`distinct` cannot compare the json column "settings" of "docs"'
      );
      expect(() =>
        loose.docs.findMany({ distinct: true, select: { id: true, settings: true } })
      ).toThrow('`distinct` cannot compare the json column "settings"');
    });

    it("leave distinct alone when not selected", async () => {
      await dsql.docs.findMany({ distinct: true, select: { title: true } });

      expect(calls[0]?.text).toMatch(/^SELECT DISTINCT/);
    });
  });

  describe("jsonb columns", () => {
    const query = async (filter: object) => {
      await where(filter);
      const call = calls.at(-1);

      return { text: call?.text.replace(/^.* WHERE /, ""), params: call?.params };
    };

    it("compare whole documents with eq and neq, sent as JSON", async () => {
      expect(await query({ doc: { eq: { a: [1, 2] } } })).toEqual({
        text: '"__t0"."doc" = $1',
        params: ['{"a":[1,2]}'],
      });
      expect(await query({ doc: { neq: "x" } })).toEqual({
        text: '"__t0"."doc" <> $1',
        params: ['"x"'],
      });
    });

    it("match a fragment with contains, as containment rather than LIKE", async () => {
      expect(await query({ doc: { contains: { a: { b: 1 } } } })).toEqual({
        text: '"__t0"."doc" @> $1',
        params: ['{"a":{"b":1}}'],
      });
    });

    it("send a fragment as given, never through the column's schema", async () => {
      expect(await query({ prefs: { contains: { size: 1 } } })).toEqual({
        text: '"__t0"."prefs" @> $1',
        params: ['{"size":1}'],
      });
      expect((await query({ prefs: { eq: {} } })).params).toEqual(["{}"]);
    });

    it.each(["in", "gt", "beginsWith"])("refuse %s", async (operator) => {
      await expect(where({ doc: { [operator]: "x" } })).rejects.toThrow(
        `Operator "${operator}" is not valid on the jsonb column "doc" of "docs" ` +
          "(valid: eq, neq, contains, exists)."
      );
    });

    it("take no bare value", async () => {
      await expect(where({ doc: { a: 1 } })).rejects.toThrow(
        'Filter the jsonb column "doc" of "docs" with one of its operators ' +
          "(eq, neq, contains, exists), not a bare value."
      );
    });

    it("cannot be ordered by", () => {
      expect(() => loose.docs.findMany({ orderBy: { doc: "asc" } })).toThrow(
        'Cannot order by the jsonb column "doc" of "docs".'
      );
    });

    it("can be compared by distinct", async () => {
      await dsql.docs.findMany({ distinct: true, select: { id: true, doc: true } });

      expect(calls[0]?.text).toMatch(/^SELECT DISTINCT/);
    });
  });

  describe("array and record columns", () => {
    const query = async (filter: object) => {
      await where(filter);
      const call = calls.at(-1);

      return { text: call?.text.replace(/^.* WHERE /, ""), params: call?.params };
    };

    it("match items with contains, given as an array", async () => {
      expect(await query({ tags: { contains: ["a", { id: 1 }] } })).toEqual({
        text: '"__t0"."tags" @> $1',
        params: ['["a",{"id":1}]'],
      });
    });

    it("refuse a lone item for contains on an array", async () => {
      await expect(where({ tags: { contains: "a" } })).rejects.toThrow(
        '`contains` on the array column "tags" of "docs" takes an array of items.'
      );
    });

    it("compare whole values with eq", async () => {
      expect(await query({ tags: { eq: ["a", "b"] } })).toEqual({
        text: '"__t0"."tags" = $1',
        params: ['["a","b"]'],
      });
    });

    it("match a record's fragment with contains, and a key with hasKey", async () => {
      expect(await query({ limits: { contains: { cpu: 2 } } })).toEqual({
        text: '"__t0"."limits" @> $1',
        params: ['{"cpu":2}'],
      });
      expect(await query({ limits: { hasKey: "cpu" } })).toEqual({
        text: '"__t0"."limits" ? $1',
        params: ["cpu"],
      });
    });

    it.each([
      ["array", "tags"],
      ["jsonb", "doc"],
    ])("refuse hasKey on a %s column", async (runtimeType, field) => {
      await expect(where({ [field]: { hasKey: "a" } })).rejects.toThrow(
        `Operator "hasKey" is not valid on the ${runtimeType} column "${field}" of "docs" ` +
          "(valid: eq, neq, contains, exists)."
      );
    });

    it("refuse hasKey on a string column", async () => {
      await expect(where({ title: { hasKey: "a" } })).rejects.toThrow(
        'Operator "hasKey" is not valid on the string column "title"'
      );
    });
  });

  describe("across a union", () => {
    it("checks a shared field's filter against each member's column", () => {
      expect(() => loose.items.findMany({ where: { settings: { eq: "x" } } })).toThrow(
        'Operator "eq" is not valid on the json column "settings"'
      );
    });

    it("refuses a direction other than asc or desc", () => {
      expect(() => loose.docs.findMany({ orderBy: { pages: "DESC" } })).toThrow(
        'Invalid direction "DESC" for "pages" in orderBy for table "docs"; use "asc" or "desc".'
      );
      expect(() => loose.items.findMany({ orderBy: { title: "up" } })).toThrow(
        'Invalid direction "up" for "title" in orderBy for union "items"'
      );
    });

    it("skips a field whose direction is undefined", async () => {
      await loose.docs.findMany({ orderBy: { pages: undefined, title: "asc" } });
      expect(calls.at(-1)?.text).toMatch(/ORDER BY "__t0"."title" ASC/);
    });

    it("cannot order by a shared json field", () => {
      expect(() => loose.items.findMany({ orderBy: { settings: "desc" } })).toThrow(
        'Cannot order by the json field "settings" of union "items".'
      );
    });
  });
});

const events = table("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  day: date("day"),
  at: datetime("at"),
  span: duration("span", { mode: "iso" }),
  size: bigint("size"),
});

const eventsSchema = { events };

const DAY = new Date("2026-05-01T00:00:00.000Z");
const AT = new Date("2026-01-02T03:04:05.000Z");

describe("filter values", () => {
  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<typeof eventsSchema>>;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema: eventsSchema, session });
  });

  const params = () => calls[0]?.params;
  const text_ = () => calls[0]?.text ?? "";

  // A `date` column stores "2026-05-01"; a filter that sent a JS Date object relied on the
  // driver to serialize it the same way. Encoding through the column's codec makes the
  // filter match what the column actually wrote.
  describe("comparison operators encode through the column codec", () => {
    it.each([
      ["eq", { day: { eq: DAY } }],
      ["neq", { day: { neq: DAY } }],
      ["gt", { day: { gt: DAY } }],
      ["gte", { day: { gte: DAY } }],
      ["lt", { day: { lt: DAY } }],
      ["lte", { day: { lte: DAY } }],
    ] as const)("%s", async (_op, where) => {
      await dsql.events.findMany({ where });
      expect(params()).toEqual(["2026-05-01"]);
    });

    it("in encodes every value", async () => {
      await dsql.events.findMany({
        where: { day: { in: [DAY, new Date("2026-06-02T00:00:00Z")] } },
      });
      expect(params()).toEqual(["2026-05-01", "2026-06-02"]);
    });

    it("between encodes both bounds", async () => {
      await dsql.events.findMany({
        where: { day: { between: [DAY, new Date("2026-06-02T00:00:00Z")] } },
      });
      expect(params()).toEqual(["2026-05-01", "2026-06-02"]);
      expect(text_()).toContain("BETWEEN");
    });

    it("the bare-value shorthand encodes", async () => {
      await dsql.events.findMany({ where: { day: DAY } });
      expect(params()).toEqual(["2026-05-01"]);
    });
  });

  describe("per column type", () => {
    it("datetime", async () => {
      await dsql.events.findMany({ where: { at: { gt: AT } } });
      expect(params()).toEqual(["2026-01-02T03:04:05.000Z"]);
    });

    it("bigint", async () => {
      await dsql.events.findMany({ where: { size: { eq: 9007199254740993n } } });
      expect(params()).toEqual(["9007199254740993"]);
    });

    it("duration", async () => {
      await dsql.events.findMany({ where: { span: { eq: "PT8H" } } });
      expect(params()).toEqual(["PT8H"]);
    });
  });

  // Pattern operators compare against a LIKE pattern, not a column value, so encoding them
  // would corrupt the pattern.
  describe("pattern operators stay raw", () => {
    it.each([
      ["beginsWith", { name: { beginsWith: "Al" } }, "Al%"],
      ["endsWith", { name: { endsWith: "ce" } }, "%ce"],
      ["contains", { name: { contains: "li" } }, "%li%"],
    ] as const)("%s", async (_op, where, expected) => {
      await dsql.events.findMany({ where });
      expect(params()).toEqual([expected]);
      expect(text_()).toContain("LIKE");
    });
  });

  describe("non-value conditions", () => {
    it("exists emits a null check with no parameter", async () => {
      await dsql.events.findMany({ where: { day: { exists: false } } });
      expect(params()).toEqual([]);
      expect(text_()).toContain("IS NULL");
    });
  });

  describe("mutations", () => {
    it("encodes update.where", async () => {
      await dsql.events.update({ set: { name: "x" }, where: { day: { eq: DAY } } });
      expect(params()).toEqual(["x", "2026-05-01"]);
    });

    it("encodes delete.where", async () => {
      await dsql.events.delete({ where: { day: { eq: DAY } } });
      expect(params()).toEqual(["2026-05-01"]);
    });
  });

  // `where: {}` used to render a bare `WHERE ` — invalid SQL. A resolver forwarding an empty
  // filter object is ordinary, so reads treat it as no filter; the operations that require a
  // `where` refuse it instead, since there it would reach an arbitrary row, or every row.
  describe("an empty where", () => {
    it.each([
      ["findMany", () => dsql.events.findMany({ where: {} })],
      ["count", () => dsql.events.count({ where: {} })],
      ["paginate", () => dsql.events.paginate({ where: {} })],
      ["an empty and group", () => dsql.events.findMany({ where: { and: [] } })],
      ["an empty or group", () => dsql.events.findMany({ where: { or: [{}] } })],
    ])("%s selects every row", async (_, run) => {
      await run();
      expect(text_()).not.toContain("WHERE");
    });

    it("keeps the other conditions beside an empty group", async () => {
      await dsql.events.findMany({ where: { name: "a", or: [] } });
      expect(text_()).toContain(`WHERE "__t0"."name" = $1`);
      expect(text_()).not.toContain("()");
    });

    it.each([
      ["findOne", () => dsql.events.findOne({ where: {} })],
      ["update", () => dsql.events.update({ set: { name: "x" }, where: {} })],
      ["delete", () => dsql.events.delete({ where: {} })],
    ])("%s refuses it before any SQL", (operation, run) => {
      expect(run).toThrow(`${operation} on "events" needs a where`);
      expect(calls).toHaveLength(0);
    });
  });

  // The built-in `pg` / PGlite drivers happen to coerce JS Dates and BigInts themselves, so
  // the columns above would also have worked unencoded. A codec that rewrites the value is
  // the case that cannot work without this — and the one `guid` columns will rely on.
  it("encodes a codec that rewrites the value", async () => {
    const calls: SQLStatement[] = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    const prefixed = table("prefixed", {
      id: new ColumnDefinition("id", {
        dataType: "text",
        codec: {
          encode: (value: string) => value.replace(/^id_/, ""),
          decode: (value: string) => `id_${value}`,
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const client = createClient({ schema: { prefixed }, session });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).prefixed.findMany({ where: { id: { eq: "id_42" } } });

    expect(calls[0]?.params).toEqual(["42"]);
  });
});

const companies = table("companies", {
  id: guid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const persons = table("persons", {
  id: guid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const tradingEntities = union({ companies, persons });

const ledgerEntries = table("ledger_entries", {
  id: guid("id").primaryKey().defaultRandom(),
  counterpartyType: text("counterparty_type"),
  counterpartyId: guid("counterparty_id"),
  amount: numeric("amount").notNull(),
});

const ledgerRelations = relations(ledgerEntries, {
  counterparty: belongsTo(tradingEntities, {
    from: [ledgerEntries.columns.counterpartyId],
    to: [tradingEntities.columns.id],
    discriminator: ledgerEntries.columns.counterpartyType,
  }),
});

const ledgerSchema = { companies, persons, tradingEntities, ledgerEntries, ledgerRelations };

const COMPANY = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const companyId = encodeGlobalId("companies", { id: COMPANY });
const personId = encodeGlobalId("persons", { id: PERSON });

describe("filters on a polymorphic id", () => {
  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<typeof ledgerSchema>>;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema: ledgerSchema, session });
  });

  const text_ = () => calls[0]?.text ?? "";
  const params = () => calls[0]?.params;

  it("matches a global id on the discriminator and the key together", async () => {
    await dsql.ledgerEntries.findMany({ where: { counterpartyId: { eq: companyId } } });

    expect(text_()).toContain(
      `WHERE ("__t0"."counterparty_type" = $1 AND "__t0"."counterparty_id" = $2)`
    );
    expect(params()).toEqual(["companies", COMPANY]);
  });

  it("negates the pair for neq, and matches the id alone for a raw uuid", async () => {
    await dsql.ledgerEntries.findMany({ where: { counterpartyId: { neq: personId } } });
    expect(text_()).toContain(`WHERE NOT ("__t0"."counterparty_type" = $1 AND`);

    calls = [];
    await dsql.ledgerEntries.findMany({ where: { counterpartyId: COMPANY } });
    expect(text_()).toContain(`WHERE "__t0"."counterparty_id" = $1`);
  });

  it("ORs one pair per global id in an in, with raw uuids on the id alone", async () => {
    await dsql.ledgerEntries.findMany({
      where: { counterpartyId: { in: [companyId, personId, COMPANY] } },
    });

    expect(text_()).toContain(
      'WHERE (("__t0"."counterparty_type" = $1 AND "__t0"."counterparty_id" = $2) OR ' +
        '("__t0"."counterparty_type" = $3 AND "__t0"."counterparty_id" = $4) OR ' +
        '"__t0"."counterparty_id" IN ($5))'
    );
  });
});

describe("filters on a column group", () => {
  // `exists` is a member here on purpose: members are named only inside `where`, so it can
  // never be read as the operator.
  const flags = embedded({ exists: boolean("exists"), note: text("note") });
  const money = embedded({
    amount: bigint("amount").notNull(),
    currency: text("currency").notNull(),
  });
  const geo = embedded({ lat: numeric("lat"), lng: numeric("lng") });
  const address = embedded({
    city: text("city"),
    geo: geo.column("geo"),
    flags: flags.column("flags"),
  });

  const invoices = table("invoices", {
    id: uuid("id").primaryKey().defaultRandom(),
    netValue: money.column("net_value"),
    billing: address.column("billing"),
  });

  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<{ invoices: typeof invoices }>>;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema: { invoices }, session });
  });

  const text_ = () => calls[0]?.text ?? "";
  const params = () => calls[0]?.params;

  it("filters members through the nested where, encoded by each member's codec", async () => {
    await dsql.invoices.findMany({
      where: { netValue: { where: { amount: { gt: 100n }, currency: "EUR" } } },
    });

    expect(text_()).toContain(
      `WHERE "__t0"."net_value_amount" > $1 AND "__t0"."net_value_currency" = $2`
    );
    expect(params()).toEqual(["100", "EUR"]);
  });

  it("filters a nested group's members, and combines them with and / or / not", async () => {
    await dsql.invoices.findMany({
      where: {
        billing: {
          where: {
            or: [{ city: "Cluj" }, { geo: { where: { lat: { gte: 44, lte: 45 } } } }],
            not: { flags: { where: { exists: true } } },
          },
        },
      },
    });

    expect(text_()).toContain(
      `WHERE ("__t0"."billing_city" = $1 OR "__t0"."billing_geo_lat" >= $2 AND ` +
        `"__t0"."billing_geo_lat" <= $3) AND NOT ("__t0"."billing_flags_exists" = $4)`
    );
  });

  it("tests presence with exists: any column set, or every column NULL", async () => {
    await dsql.invoices.findMany({ where: { billing: { where: { geo: { exists: true } } } } });
    expect(text_()).toContain(
      `WHERE ("__t0"."billing_geo_lat" IS NOT NULL OR "__t0"."billing_geo_lng" IS NOT NULL)`
    );

    calls = [];
    await dsql.invoices.findMany({ where: { billing: { exists: false } } });
    expect(text_()).toContain(
      `WHERE "__t0"."billing_city" IS NULL AND "__t0"."billing_geo_lat" IS NULL`
    );
  });

  it("refuses a value, a member beside where, or another operator on a group", () => {
    expect(() =>
      dsql.invoices.findMany({ where: { netValue: { amount: 1n, currency: "EUR" } } as never })
    ).toThrow(/Operator "amount" is not valid on the group "netValue" of "invoices"/);
    expect(() => dsql.invoices.findMany({ where: { netValue: "x" } as never })).toThrow(
      /Filter the group "netValue" of "invoices" with `exists` or a nested `where`, not a value/
    );
    expect(() => dsql.invoices.findMany({ where: { netValue: { eq: 1 } } as never })).toThrow(
      /Operator "eq" is not valid on the group/
    );
  });

  it("refuses a member the group does not have, and an operator its type does not take", () => {
    expect(() =>
      dsql.invoices.findMany({ where: { netValue: { where: { nope: 1 } } } as never })
    ).toThrow(/Invalid field "netValue.nope" in where clause/);
    expect(() =>
      dsql.invoices.findMany({
        where: { netValue: { where: { amount: { beginsWith: "1" } } } } as never,
      })
    ).toThrow(/not valid on the bigint column "netValue.amount" of "invoices"/);
  });
});
