import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DefinitionSchema,
  SchemaRegistry,
  type Session,
  sql,
  type SQLNode,
  type SQLStatement,
} from "@dsqlbase/core";
import { createClient } from "./create.js";
import { getDynamicGuidBinding, getGuidBinding, getNodes, registerNodes } from "./nodes.js";
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
import { encodeGlobalId } from "../schema/utils/global-id.js";

function register<TSchema extends DefinitionSchema>(schema: TSchema) {
  const registry = new SchemaRegistry(schema);
  const nodes = registerNodes(registry as SchemaRegistry<DefinitionSchema>, schema);

  return { registry, nodes };
}

describe("registerNodes", () => {
  it("should make a table with a single guid primary key a node, keyed by its alias", () => {
    const authors = table("authors", {
      id: guid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
    });

    const { nodes } = register({ authors });
    const node = nodes.get("authors");

    expect(node?.alias).toBe("authors");
    expect(node?.keyField).toBe("id");
    expect(node?.keyColumn.name).toBe("id");
  });

  it("should key a node by its alias, not its database name", () => {
    // `revisions` → `article_revisions`, the shape the e2e fixture uses. Ids follow the
    // client-visible identity, so renaming the table does not invalidate ids in the wild.
    const revisions = table("article_revisions", {
      id: guid("id").primaryKey().defaultRandom(),
    });

    const { nodes } = register({ revisions });

    expect([...nodes.keys()]).toEqual(["revisions"]);
    expect(nodes.get("revisions")?.table.name).toBe("article_revisions");
  });

  it("should let a key column override the node key", () => {
    // The override doubles as a stable label: re-keying the schema object would otherwise
    // change every id already handed out.
    const people = table("users", {
      id: guid("id", "users").primaryKey().defaultRandom(),
    });

    const { nodes } = register({ people });

    expect([...nodes.keys()]).toEqual(["users"]);
    expect(nodes.get("users")?.alias).toBe("people");
  });

  it("should not make a uuid-keyed table a node", () => {
    const teams = table("teams", { id: uuid("id").primaryKey().defaultRandom() });

    expect(register({ teams }).nodes.size).toBe(0);
  });

  it("should not make a composite-key table a node", () => {
    // `guid()` can only name one column, so nothing could produce an id for this table.
    const memberships = table("memberships", {
      teamId: guid("team_id", "teams"),
      userId: guid("user_id", "users"),
    }).primaryKey((c) => [c.teamId, c.userId]);

    const teams = table("teams", { id: guid("id").primaryKey() });
    const users = table("users", { id: guid("id").primaryKey() });

    const { nodes } = register({ teams, users, memberships });

    expect([...nodes.keys()].sort()).toEqual(["teams", "users"]);
  });

  it("should bind a key column to its own node", () => {
    const authors = table("authors", { id: guid("id").primaryKey() });

    const { registry } = register({ authors });

    expect(getGuidBinding(registry.getTable("authors").columns.id)).toEqual({
      key: "authors",
      keyField: "id",
    });
  });

  it("should bind a reference column to the node it points at", () => {
    // The whole point of the key argument: `article.authorId` and `article.author.id` wrap
    // with the same node, so the two strings are identical without the caller unwrapping.
    const authors = table("authors", { id: guid("id").primaryKey() });
    const articles = table("articles", {
      id: guid("id").primaryKey(),
      authorId: guid("author_id", "authors").notNull(),
    });

    const { registry } = register({ authors, articles });
    const columns = registry.getTable("articles").columns;

    expect(getGuidBinding(columns.authorId)).toEqual({ key: "authors", keyField: "id" });
    expect(getGuidBinding(columns.id)).toEqual({ key: "articles", keyField: "id" });
  });

  it("should bind a keyless non-key column to its own table, as a self reference", () => {
    const articles = table("articles", {
      id: guid("id").primaryKey(),
      parentId: guid("parent_id"),
    });

    const { registry } = register({ articles });

    expect(getGuidBinding(registry.getTable("articles").columns.parentId)).toEqual({
      key: "articles",
      keyField: "id",
    });
  });

  it("should bind to the target's key field name, not to `id`", () => {
    const memberships = table("memberships", {
      membershipId: guid("membership_id").primaryKey(),
    });

    const teams = table("teams", {
      id: guid("id").primaryKey(),
      leadMembership: guid("lead_membership", "memberships"),
    });

    const { registry } = register({ memberships, teams });

    expect(getGuidBinding(registry.getTable("teams").columns.leadMembership)).toEqual({
      key: "memberships",
      keyField: "membershipId",
    });
  });

  it("should leave a uuid column unbound", () => {
    const authors = table("authors", {
      id: guid("id").primaryKey(),
      name: uuid("name"),
    });

    const { registry } = register({ authors });

    expect(getGuidBinding(registry.getTable("authors").columns.name)).toBeUndefined();
  });

  it("should reject two tables claiming one node key", () => {
    const users = table("users", { id: guid("id", "people").primaryKey() });
    const people = table("people", { id: guid("id").primaryKey() });

    expect(() => register({ users, people })).toThrow(/both claim the node key "people"/);
  });

  it("should reject a column pointing at a table that is not a node", () => {
    const teams = table("teams", { id: uuid("id").primaryKey() });
    const users = table("users", {
      id: guid("id").primaryKey(),
      teamId: guid("team_id", "teams").notNull(),
    });

    expect(() => register({ teams, users })).toThrow(
      /"users\.teamId" carries global ids for "teams", which is not a node/
    );
  });

  it("should reject a column pointing at a composite-key table", () => {
    const memberships = table("memberships", {
      teamId: guid("team_id", "teams"),
      userId: guid("user_id", "teams"),
    }).primaryKey((c) => [c.teamId, c.userId]);

    const teams = table("teams", {
      id: guid("id").primaryKey(),
      pinned: guid("pinned", "memberships"),
    });

    expect(() => register({ teams, memberships })).toThrow(
      /"teams\.pinned" carries global ids for "memberships", which is not a node/
    );
  });

  it("should name the nodes a schema does have when a key does not resolve", () => {
    const authors = table("authors", { id: guid("id").primaryKey() });
    const articles = table("articles", {
      id: guid("id").primaryKey(),
      authorId: guid("author_id", "author").notNull(),
    });

    expect(() => register({ authors, articles })).toThrow(/this schema has "authors", "articles"/);
  });
});

describe("getNodes", () => {
  it("should be empty for a registry that was never registered", () => {
    const authors = table("authors", { id: guid("id").primaryKey() });

    expect(getNodes(new SchemaRegistry({ authors }))).toEqual(new Map());
  });
});

describe("the bound codec", () => {
  const UUID = "3f1c0e3e-0a3f-4a1e-9c2e-8b5f1d2a7c44";

  /**
   * The value a node would actually send to the driver.
   *
   * A codec runs when the parameter is *rendered*, not when it is built, so asserting on a
   * freshly built `SQLParam` would pass whether or not anything is bound.
   */
  function bound(node: SQLNode): unknown {
    return sql`${node}`.toQuery().params[0];
  }

  function fixture() {
    const authors = table("authors", { id: guid("id").primaryKey() });
    const articles = table("articles", {
      id: guid("id").primaryKey(),
      authorId: guid("author_id", "authors").notNull(),
      slug: text("slug").notNull(),
    });

    const { registry } = register({ authors, articles });

    return { authors: registry.getTable("authors"), articles: registry.getTable("articles") };
  }

  it("should wrap a value read off a row", () => {
    const { articles } = fixture();

    expect(articles.columns.id.resolve(UUID)).toBe(encodeGlobalId("articles", { id: UUID }));
  });

  it("should wrap a reference column with the node it points at, not its own table", () => {
    // This is what makes `article.authorId === article.author.id` hold: both sides wrap with
    // the authors node, so the two strings are the same without the caller unwrapping either.
    const { authors, articles } = fixture();

    // Asserted against the authors-keyed value, not merely against the other column: two
    // identity codecs would agree with each other and prove nothing.
    expect(articles.columns.authorId.resolve(UUID)).toBe(encodeGlobalId("authors", { id: UUID }));
    expect(articles.columns.authorId.resolve(UUID)).toBe(authors.columns.id.resolve(UUID));
    expect(articles.columns.authorId.resolve(UUID)).not.toBe(articles.columns.id.resolve(UUID));
  });

  it("should leave a non-guid column alone", () => {
    const { articles } = fixture();

    expect(articles.columns.slug.resolve("a-slug")).toBe("a-slug");
  });

  it("should unwrap a global id written to the column", () => {
    const { articles } = fixture();
    const id = encodeGlobalId("articles", { id: UUID });

    expect(bound(articles.columns.id.getInsertValue(id))).toBe(UUID);
    expect(bound(articles.columns.id.getUpdateValue(id))).toBe(UUID);
  });

  it("should unwrap a global id used as a filter value", () => {
    // The filter path is separate from the write path and has its own history of being
    // missed, so it gets its own assertion rather than riding on the insert one.
    const { articles } = fixture();
    const id = encodeGlobalId("articles", { id: UUID });

    expect(bound(articles.columns.id.param(id))).toBe(UUID);
  });

  it("should accept a raw uuid on either path", () => {
    // Lenient on input: ids reach an application from places that never went through the ORM.
    const { articles } = fixture();

    expect(bound(articles.columns.id.param(UUID))).toBe(UUID);
    expect(bound(articles.columns.id.getInsertValue(UUID))).toBe(UUID);
  });

  it("should refuse a global id from another table", () => {
    // The wrong-table safety net. A bare uuid would simply have matched nothing.
    const { articles } = fixture();
    const id = encodeGlobalId("authors", { id: UUID });

    expect(() => bound(articles.columns.id.param(id))).toThrow(
      expect.objectContaining({ code: "key_mismatch" })
    );
  });

  it("should refuse a payload naming the right table but the wrong key field", () => {
    const { articles } = fixture();
    const forged = encodeGlobalId("articles", { slug: "a-slug" });

    expect(() => bound(articles.columns.id.param(forged))).toThrow(
      /carries "slug" rather than its key "id"/
    );
  });

  it("should round-trip through the column", () => {
    const { articles } = fixture();
    const wrapped = articles.columns.id.resolve(UUID);

    expect(bound(articles.columns.id.param(wrapped))).toBe(UUID);
  });

  it("should leave a column raw when the registry was never registered", () => {
    // A `SchemaRegistry` built by hand has no bind pass, so a guid column behaves exactly
    // like the uuid column it serializes as.
    const authors = table("authors", { id: guid("id").primaryKey() });

    expect(new SchemaRegistry({ authors }).getTable("authors").columns.id.resolve(UUID)).toBe(UUID);
  });
});

describe("guid relation pairs", () => {
  const authors = () => table("authors", { id: guid("id").primaryKey() });
  const teams = () => table("teams", { id: uuid("id").primaryKey() });

  it("accepts a pair that names the same node", () => {
    const a = authors();
    const articles = table("articles", {
      id: guid("id").primaryKey(),
      authorId: guid("author_id", "authors").notNull(),
    });

    const articleRelations = relations(articles, {
      author: belongsTo(a, { from: [articles.columns.authorId], to: [a.columns.id] }),
    });

    expect(() => register({ authors: a, articles, articleRelations })).not.toThrow();
  });

  it("rejects a guid paired with a plain uuid", () => {
    // The mistake it catches: a relation to a node whose key column was left as `uuid()`.
    // The join still works — SQL correlates on raw columns — but `draft.authorId` reads back
    // raw while `draft.author.id` reads back wrapped, so they never compare equal.
    const a = authors();
    const drafts = table("drafts", {
      id: uuid("id").primaryKey(),
      authorId: uuid("author_id").notNull(),
    });

    const draftRelations = relations(drafts, {
      author: belongsTo(a, { from: [drafts.columns.authorId], to: [a.columns.id] }),
    });

    expect(() => register({ authors: a, drafts, draftRelations })).toThrow(
      /only one of them carries global ids/
    );
  });

  it("rejects a guid paired with a guid for another node", () => {
    const a = authors();
    const articles = table("articles", {
      id: guid("id").primaryKey(),
      // Points at the wrong node: two different strings for one row.
      authorId: guid("author_id", "articles").notNull(),
    });

    const articleRelations = relations(articles, {
      author: belongsTo(a, { from: [articles.columns.authorId], to: [a.columns.id] }),
    });

    expect(() => register({ authors: a, articles, articleRelations })).toThrow(
      /carry global ids for "articles" and "authors"/
    );
  });

  it("names both sides of the offending pair", () => {
    const a = authors();
    const drafts = table("drafts", {
      id: uuid("id").primaryKey(),
      authorId: uuid("author_id").notNull(),
    });

    const draftRelations = relations(drafts, {
      author: belongsTo(a, { from: [drafts.columns.authorId], to: [a.columns.id] }),
    });

    expect(() => register({ authors: a, drafts, draftRelations })).toThrow(
      /"drafts\.author_id" and "authors\.id"/
    );
  });

  it("checks a relation to a union against every member", () => {
    const users = table("users", { id: guid("id").primaryKey() });
    const photos = table("photos", {
      id: guid("id").primaryKey(),
      userId: guid("user_id", "users"),
    });
    const videos = table("videos", {
      id: guid("id").primaryKey(),
      // Raw on one member only: `user.feed[n].userId` would read back raw for videos.
      userId: uuid("user_id"),
    });
    const posts = union({ photos, videos });

    const userRelations = relations(users, {
      feed: hasMany(posts, {
        from: [users.columns.id],
        to: { photos: [photos.columns.userId], videos: [videos.columns.userId] },
      }),
    });

    expect(() => register({ users, photos, videos, posts, userRelations })).toThrow(
      /"users\.id" and "videos\.user_id", but only one of them carries global ids/
    );
  });

  it("leaves a relation between two plain uuid columns alone", () => {
    const t = teams();
    const users = table("users", {
      id: uuid("id").primaryKey(),
      teamId: uuid("team_id").notNull(),
    });

    const userRelations = relations(users, {
      team: belongsTo(t, { from: [users.columns.teamId], to: [t.columns.id] }),
    });

    expect(() => register({ teams: t, users, userRelations })).not.toThrow();
  });
});

describe("polymorphic guid columns", () => {
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
  });
});
