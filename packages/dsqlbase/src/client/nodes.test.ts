import { describe, expect, it } from "vitest";
import { SchemaRegistry } from "@dsqlbase/core";
import { getGuidBinding, getNodes, registerNodes } from "./nodes.js";
import { guid, table, text, uuid } from "../schema/index.js";

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
