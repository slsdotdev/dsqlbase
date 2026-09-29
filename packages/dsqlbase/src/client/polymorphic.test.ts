import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SchemaRegistry,
  type DefinitionSchema,
  type Session,
  type SQLStatement,
} from "@dsqlbase/core";
import { createClient } from "./create.js";
import { getDynamicGuidBinding, getGuidBinding, registerNodes } from "./nodes.js";
import {
  belongsTo,
  guid,
  hasMany,
  numeric,
  relations,
  table,
  text,
  union,
  uuid,
} from "../schema/index.js";
import { encodeGlobalId, GlobalIdError } from "../schema/utils/global-id.js";

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

const schema = { companies, persons, tradingEntities, ledgerEntries, ledgerRelations };

const COMPANY = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const companyId = encodeGlobalId("companies", { id: COMPANY });
const personId = encodeGlobalId("persons", { id: PERSON });

function register<TSchema extends DefinitionSchema>(definition: TSchema) {
  const registry = new SchemaRegistry(definition);
  registerNodes(registry as SchemaRegistry<DefinitionSchema>, definition);
  return registry;
}

describe("binding a polymorphic guid column", () => {
  it("binds the from column to the discriminator instead of a fixed node", () => {
    const registry = register(schema);
    const column = registry.getTable("ledgerEntries").columns.counterpartyId;

    expect(getGuidBinding(column)).toBeUndefined();
    expect(getDynamicGuidBinding(column)).toEqual({
      discriminator: registry.getTable("ledgerEntries").columns.counterpartyType,
      discriminatorField: "counterpartyType",
      members: { companies: "id", persons: "id" },
    });
  });

  it("rejects a static key on the discriminated column", () => {
    const entries = table("entries", {
      id: guid("id").primaryKey(),
      kind: text("kind"),
      targetId: guid("target_id", "companies"),
    });
    const rels = relations(entries, {
      target: belongsTo(tradingEntities, {
        from: [entries.columns.targetId],
        to: [tradingEntities.columns.id],
        discriminator: entries.columns.kind,
      }),
    });

    expect(() => register({ companies, persons, tradingEntities, entries, rels })).toThrow(
      /names node "companies", but relation "target" reads its node from discriminator "kind"/
    );
  });

  it("rejects a member that is not a node", () => {
    const shops = table("shops", { id: uuid("id").primaryKey(), name: text("name") });
    const sellers = union({ companies, shops });
    const entries = table("entries", {
      id: guid("id").primaryKey(),
      kind: text("kind"),
      sellerId: guid("seller_id"),
    });
    const rels = relations(entries, {
      seller: belongsTo(sellers, {
        from: [entries.columns.sellerId],
        to: [sellers.columns.id],
        discriminator: entries.columns.kind,
      }),
    });

    expect(() => register({ companies, shops, sellers, entries, rels })).toThrow(
      /union member "shops" is not a node keyed by "id"/
    );
  });

  it("accepts a reverse has-many from a member onto the polymorphic column", () => {
    const companyRelations = relations(companies, {
      entries: hasMany(ledgerEntries, {
        from: [companies.columns.id],
        to: [ledgerEntries.columns.counterpartyId],
      }),
    });

    expect(() => register({ ...schema, companyRelations })).not.toThrow();
  });

  it("rejects a plain uuid paired with the polymorphic column", () => {
    const shops = table("shops", { id: uuid("id").primaryKey() });
    const shopRelations = relations(shops, {
      entries: hasMany(ledgerEntries, {
        from: [shops.columns.id],
        to: [ledgerEntries.columns.counterpartyId],
      }),
    });

    expect(() => register({ ...schema, shops, shopRelations })).toThrow(
      /only one of them carries global ids/
    );
  });
});

describe("a polymorphic belongs-to", () => {
  let calls: SQLStatement[];
  let rows: unknown[];
  let dsql: ReturnType<typeof createClient<typeof schema>>;

  beforeEach(() => {
    calls = [];
    rows = [];

    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return rows;
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
  });

  const text_ = () => calls[0]?.text ?? "";
  const params = () => calls[0]?.params;

  describe("reading", () => {
    it("wraps the id with the member its discriminator names", async () => {
      rows = [
        { id: "e1", counterparty_type: "persons", counterparty_id: PERSON, amount: "10" },
        { id: "e2", counterparty_type: null, counterparty_id: COMPANY, amount: "5" },
      ];

      const entries = await dsql.ledgerEntries.findMany({});

      expect(entries[0]?.counterpartyId).toBe(personId);
      // No discriminator, no node to name: the id reads raw.
      expect(entries[1]?.counterpartyId).toBe(COMPANY);
    });

    it("reads the discriminator for the id without returning it when it was not selected", async () => {
      rows = [{ counterparty_id: COMPANY, counterparty_type: "companies" }];

      const [entry] = await dsql.ledgerEntries.findMany({ select: { counterpartyId: true } });

      expect(text_()).toBe(
        'SELECT "__t0"."counterparty_id", "__t0"."counterparty_type" FROM "ledger_entries" AS "__t0"'
      );
      expect(entry).toEqual({
        $$meta: { key: "ledgerEntries", table: "ledger_entries" },
        counterpartyId: companyId,
      });
    });

    it("joins only the member the discriminator names, so counterpartyId === counterparty.id", async () => {
      rows = [
        {
          id: "e1",
          counterparty_type: "companies",
          counterparty_id: COMPANY,
          amount: "10",
          counterparty: { $$key: "companies", id: COMPANY, name: "Acme" },
        },
      ];

      const [entry] = await dsql.ledgerEntries.findMany({ join: { counterparty: true } });

      expect(text_()).toContain(
        `WHERE "__t1"."id" = "__t0"."counterparty_id" AND "__t0"."counterparty_type" = 'companies'`
      );
      expect(text_()).toContain(`AND "__t0"."counterparty_type" = 'persons'`);
      expect(entry?.counterparty?.$$key).toBe("companies");
      expect(entry?.counterpartyId).toBe(entry?.counterparty?.id);
    });
  });

  describe("writing", () => {
    it("fills the discriminator from a global id", async () => {
      await dsql.ledgerEntries.create({ data: { counterpartyId: companyId, amount: 10 } });

      expect(text_()).toContain('"counterparty_type", "counterparty_id"');
      expect(params()).toEqual(expect.arrayContaining(["companies", COMPANY]));
    });

    it("accepts a discriminator that agrees, and refuses one that does not", () => {
      expect(() =>
        dsql.ledgerEntries.create({
          data: { counterpartyId: companyId, counterpartyType: "companies", amount: 1 },
        })
      ).not.toThrow();

      expect(() =>
        dsql.ledgerEntries.create({
          data: { counterpartyId: companyId, counterpartyType: "persons", amount: 1 },
        })
      ).toThrow(GlobalIdError);
    });

    it("refuses a global id for a table outside the union", () => {
      const entryId = encodeGlobalId("ledgerEntries", { id: COMPANY });

      expect(() =>
        dsql.ledgerEntries.create({ data: { counterpartyId: entryId, amount: 1 } })
      ).toThrow(/this column holds ids for "companies", "persons"/);
    });

    it("leaves the discriminator alone for a raw uuid, and fills it on update", async () => {
      await dsql.ledgerEntries.create({ data: { counterpartyId: COMPANY, amount: 1 } });
      expect(params()).not.toContain("companies");

      calls = [];
      await dsql.ledgerEntries.update({
        set: { counterpartyId: personId },
        where: { amount: { eq: 1 } },
      });

      expect(text_()).toContain('SET "counterparty_id" = $1, "counterparty_type" = $2');
      expect(params()?.slice(0, 2)).toEqual([PERSON, "persons"]);
    });
  });

  describe("filtering", () => {
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
});
