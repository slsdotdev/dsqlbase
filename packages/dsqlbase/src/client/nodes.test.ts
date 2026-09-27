import { describe, expect, it } from "vitest";
import { SchemaRegistry, sql, type SQLNode } from "@dsqlbase/core";
import { getGuidBinding, getNodes, registerNodes } from "./nodes.js";
import { guid, table, text, uuid } from "../schema/index.js";
import { encodeGlobalId } from "../schema/utils/global-id.js";

function register(schema: Record<string, unknown>) {
  const registry = new SchemaRegistry(schema as never);

  return { registry, nodes: registerNodes(registry, schema as never) };
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
