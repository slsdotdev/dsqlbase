import { describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
} from "../definition/index.js";
import { SchemaRegistry } from "./registry.js";
import { Table } from "./table.js";

const users = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").unique(),
  },
});

const posts = new TableDefinition("posts", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    title: new ColumnDefinition("title").notNull(),
    content: new ColumnDefinition("content"),
    publishedAt: new ColumnDefinition("published_at"),
    authorId: new ColumnDefinition("author_id").notNull(),
  },
});

const usersRelations = new RelationsDefinition(users, {
  posts: {
    type: Relation.HAS_MANY,
    target: posts,
    from: [users.columns.id],
    to: [posts.columns.authorId],
  },
});

const postsRelations = new RelationsDefinition(posts, {
  author: {
    type: Relation.BELONGS_TO,
    target: users,
    from: [posts.columns.authorId],
    to: [users.columns.id],
  },
});

export const usersDislikedPosts = new RelationsDefinition(users, {
  dislikedPosts: {
    type: Relation.HAS_MANY,
    target: posts,
    from: [users.columns.id],
    to: [posts.columns.id],
  },
});

const teamMembers = new TableDefinition("team_members", {
  columns: {
    teamId: new ColumnDefinition("team_id").notNull(),
    userId: new ColumnDefinition("user_id").notNull(),
  },
});
teamMembers.primaryKey((c) => [c.teamId, c.userId]);

describe("SchemaRegistry", () => {
  it("should create a registry with the provided schema", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    expect(registry).toBeInstanceOf(SchemaRegistry);
  });

  it("should retrieve a table by name", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    const usersTable = registry.getTable("users");
    const postsTable = registry.getTable("posts");

    expect(usersTable).toBeInstanceOf(Table);
    expect(usersTable.name).toBe("users");

    expect(postsTable).toBeInstanceOf(Table);
    expect(postsTable.name).toBe("posts");
  });

  it("should check if a table exists", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    expect(registry.hasTable("users")).toBe(true);
    expect(registry.hasTable("posts")).toBe(true);
    expect(registry.hasTable("nonexistent")).toBe(false);
  });

  it("should retrieve all tables", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    const tables = registry.getTables();

    expect(tables).toHaveProperty("users");
    expect(tables).toHaveProperty("posts");
  });

  describe("aliases", () => {
    // `members` is exported under an alias that differs from the table name, the shape
    // the e2e fixture uses (`members` -> `team_members`).
    const registry = new SchemaRegistry({ users, posts, members: teamMembers });

    it("should set the table alias from the schema object key", () => {
      expect(registry.getTable("members").alias).toBe("members");
      expect(registry.getTable("members").name).toBe("team_members");
      expect(registry.getTable("users").alias).toBe("users");
    });

    it("should resolve the alias from either the alias or the table name", () => {
      expect(registry.getAlias("members")).toBe("members");
      expect(registry.getAlias("team_members")).toBe("members");
      expect(() => registry.getAlias("nonexistent")).toThrow(/Table not found: nonexistent/);
    });

    it("should list each table once, keyed by alias", () => {
      const entries = registry.getTableEntries();

      expect(entries.map(([alias]) => alias).sort()).toEqual(["members", "posts", "users"]);
      expect(new Set(entries.map(([, table]) => table)).size).toBe(3);
    });

    // getTables() keys every table by both its alias and its table name, so an aliased
    // table appears twice. getTableEntries() exists precisely to avoid that.
    it("should not inherit the duplicate keys getTables() returns", () => {
      const tables = registry.getTables() as Record<string, unknown>;

      expect(Object.keys(tables)).toContain("team_members");
      expect(Object.keys(tables)).toContain("members");
      expect(registry.getTableEntries().map(([alias]) => alias)).not.toContain("team_members");
    });

    it("should default the alias to the table name when built directly", () => {
      expect(new Table(teamMembers).alias).toBe("team_members");
    });
  });

  describe("relation pair validation", () => {
    const memberships = new TableDefinition("memberships", {
      columns: {
        teamId: new ColumnDefinition("team_id", { dataType: "uuid" }),
        userId: new ColumnDefinition("user_id", { dataType: "uuid" }),
        role: new ColumnDefinition("role", { dataType: "text" }),
      },
    });

    const assignments = new TableDefinition("assignments", {
      columns: {
        teamId: new ColumnDefinition("team_id", { dataType: "uuid" }),
        userId: new ColumnDefinition("user_id", { dataType: "uuid" }),
        note: new ColumnDefinition("note", { dataType: "text" }),
      },
    });

    const relate = (from: unknown[], to: unknown[]) =>
      new RelationsDefinition(assignments, {
        membership: {
          type: Relation.BELONGS_TO,
          target: memberships,
          from,
          to,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

    it("accepts a multi-column pair", () => {
      const registry = new SchemaRegistry({
        assignments,
        memberships,
        rel: relate(
          [assignments.columns.teamId, assignments.columns.userId],
          [memberships.columns.teamId, memberships.columns.userId]
        ),
      });

      expect(registry.getRelations("assignments")).toHaveProperty("membership");
    });

    it("rejects sides of unequal length", () => {
      expect(
        () =>
          new SchemaRegistry({
            assignments,
            memberships,
            rel: relate(
              [assignments.columns.teamId, assignments.columns.userId],
              [memberships.columns.teamId]
            ),
          })
      ).toThrow(/pairs 2 "from" column\(s\) with 1 "to" column\(s\)/);
    });

    it("rejects an empty pair list", () => {
      expect(
        () => new SchemaRegistry({ assignments, memberships, rel: relate([], []) })
      ).toThrow(/must declare at least one column pair/);
    });

    // Identity, not name: `memberships.teamId` is a uuid called "team_id" just like
    // `assignments.teamId`, so a name-based check would wave this through.
    it("rejects a from column that belongs to another table", () => {
      expect(
        () =>
          new SchemaRegistry({
            assignments,
            memberships,
            rel: relate([memberships.columns.teamId], [memberships.columns.teamId]),
          })
      ).toThrow(/"from" column "team_id" is not declared on table "assignments"/);
    });

    it("rejects a to column that belongs to another table", () => {
      expect(
        () =>
          new SchemaRegistry({
            assignments,
            memberships,
            rel: relate([assignments.columns.teamId], [assignments.columns.teamId]),
          })
      ).toThrow(/"to" column "team_id" is not declared on target table "memberships"/);
    });

    it("rejects a pair whose sides have different types", () => {
      expect(
        () =>
          new SchemaRegistry({
            assignments,
            memberships,
            rel: relate([assignments.columns.note], [memberships.columns.userId]),
          })
      ).toThrow(
        /"assignments"\."note" is "text" but "memberships"\."userId" is "uuid"/
      );
    });

    it("rejects a relation whose target is not in the schema", () => {
      expect(
        () =>
          new SchemaRegistry({
            assignments,
            rel: relate([assignments.columns.teamId], [memberships.columns.teamId]),
          })
      ).toThrow(/targets table "memberships", which is not in the schema/);
    });
  });

  describe("field namespace", () => {
    const articles = new TableDefinition("articles", {
      columns: {
        id: new ColumnDefinition("id", { primaryKey: true }),
        author: new ColumnDefinition("author", { dataType: "text" }),
      },
    });

    const authors = new TableDefinition("authors", {
      columns: {
        id: new ColumnDefinition("id", { primaryKey: true }),
        name: new ColumnDefinition("name", { dataType: "text" }),
      },
    });

    it("rejects a relation named like a column on the same table", () => {
      expect(
        () =>
          new SchemaRegistry({
            articles,
            authors,
            rel: new RelationsDefinition(articles, {
              author: {
                type: Relation.BELONGS_TO,
                target: authors,
                from: [articles.columns.id],
                to: [authors.columns.id],
              },
            }),
          })
      ).toThrow(/Relation "author" on table "articles" collides with a column of the same name/);
    });

    it("accepts a relation named like a column of a different table", () => {
      const registry = new SchemaRegistry({
        articles,
        authors,
        // "author" is a column on `articles`, but this relation is declared on `authors`,
        // which has no such column. The namespace is per table, not per schema.
        rel: new RelationsDefinition(authors, {
          author: {
            type: Relation.BELONGS_TO,
            target: articles,
            from: [authors.columns.id],
            to: [articles.columns.id],
          },
        }),
      });

      expect(registry.getRelations("authors")).toHaveProperty("author");
    });
  });

  it("should check if relations exist for a table", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    expect(registry.hasRelations("users")).toBe(true);
    expect(registry.hasRelations("posts")).toBe(true);
    expect(registry.hasRelations("nonexistent")).toBe(false);
  });

  it("should retrieve relations for a table", () => {
    const registry = new SchemaRegistry({
      users,
      posts,
      usersRelations,
      postsRelations,
      usersDislikedPosts,
    });

    const usersTableRelations = registry.getRelations("users");
    const postsTableRelations = registry.getRelations("posts");

    expect(usersTableRelations).toHaveProperty("posts");
    expect(usersTableRelations).toHaveProperty("dislikedPosts");
    expect(postsTableRelations).toHaveProperty("author");
  });

  it("should retrieve relation target fields", () => {
    const registry = new SchemaRegistry({ users, posts, usersRelations, postsRelations });

    const userPostsTarget = registry.getRelationTarget("users", "posts");
    const postAuthorTarget = registry.getRelationTarget("posts", "author");

    expect(userPostsTarget).toEqual(registry.getTable("posts"));
    expect(postAuthorTarget).toEqual(registry.getTable("users"));
  });
});
