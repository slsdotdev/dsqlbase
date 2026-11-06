import { describe, expect, it } from "vitest";
import { SchemaRegistry } from "@dsqlbase/core";
import { belongsTo, guid, relations, table, text, union } from "../index.js";
import { encodeGlobalId } from "./global-id.js";
import { getDynamicGuidBinding, getGuidBinding, guidHooks } from "./guid-hooks.js";

const UUID = "0b1f6f4e-8d2a-4c1b-9a7e-3f5d2c1b0a99";

const authors = table("authors", { id: guid("id").primaryKey() });
const articles = table("articles", { id: guid("id").primaryKey(), authorId: guid("author_id") });
const companies = table("companies", { id: guid("id").primaryKey() });
const persons = table("persons", { id: guid("id").primaryKey() });
const parties = union({ companies, persons }, { id: guid("id") });
const entries = table("entries", {
  id: guid("id").primaryKey(),
  partyType: text("party_type"),
  partyId: guid("party_id"),
});

const registry = new SchemaRegistry({
  authors,
  articles,
  companies,
  persons,
  parties,
  entries,
  articleRelations: relations(articles, {
    author: belongsTo(authors, { from: [articles.columns.authorId], to: [authors.columns.id] }),
  }),
  entryRelations: relations(entries, {
    party: belongsTo(parties, {
      from: [entries.columns.partyId],
      to: [parties.columns.id],
      discriminator: entries.columns.partyType,
    }),
  }),
});

const authorId = registry.getTable("articles").columns.authorId;
const partyId = registry.getTable("entries").columns.partyId;

describe("guidHooks", () => {
  it("is the one hooks object every guid() column carries", () => {
    expect(authorId.hooks).toBe(guidHooks);
    expect(partyId.hooks).toBe(guidHooks);
  });

  it("reads a key as the id of the column it references, and writes it back raw", () => {
    const wrapped = encodeGlobalId("authors", { id: UUID });

    expect(authorId.resolve(UUID)).toBe(wrapped);
    expect(guidHooks.write?.(wrapped, { column: authorId })).toBe(UUID);
    expect(guidHooks.write?.(UUID, { column: authorId })).toBe(UUID);
  });

  it("refuses an id naming another node", () => {
    expect(() =>
      guidHooks.write?.(encodeGlobalId("articles", { id: UUID }), { column: authorId })
    ).toThrow(expect.objectContaining({ code: "key_mismatch" }));
  });

  it("reads a polymorphic key as the member its row names, raw otherwise", () => {
    expect(partyId.resolve(UUID, { party_type: "persons" })).toBe(
      encodeGlobalId("persons", { id: UUID })
    );
    expect(partyId.resolve(UUID, { party_type: null })).toBe(UUID);
    expect(partyId.resolve(UUID, { party_type: "robots" })).toBe(UUID);
  });

  it("writes an id of any member back raw, and refuses a non-member", () => {
    expect(guidHooks.write?.(encodeGlobalId("companies", { id: UUID }), { column: partyId })).toBe(
      UUID
    );
    expect(() =>
      guidHooks.write?.(encodeGlobalId("authors", { id: UUID }), { column: partyId })
    ).toThrow(/cannot be stored here/);
  });

  it("resolves a column's binding once", () => {
    expect(getGuidBinding(authorId)).toBe(getGuidBinding(authorId));
    expect(getDynamicGuidBinding(partyId)).toBe(getDynamicGuidBinding(partyId));
    expect(getGuidBinding(partyId)).toBeUndefined();
  });

  it("binds nothing for a column without guid hooks", () => {
    expect(getGuidBinding(registry.getTable("entries").columns.partyType)).toBeUndefined();
  });
});
