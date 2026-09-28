import { describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
  TenantScopeDefinition,
  UnionDefinition,
} from "../definition/index.js";
import { SchemaRegistry } from "./registry.js";
import { Table } from "./table.js";
import { Union } from "./union.js";

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

    it.each(["$$meta", "$$key"])("rejects a relation named %s", (field) => {
      expect(
        () =>
          new SchemaRegistry({
            articles,
            authors,
            rel: new RelationsDefinition(articles, {
              [field]: {
                type: Relation.BELONGS_TO,
                target: authors,
                from: [articles.columns.id],
                to: [authors.columns.id],
              },
            }),
          })
      ).toThrow(`declares a relation named "${field}", which is reserved`);
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

describe("SchemaRegistry over a shared schema", () => {
  it("can be built twice from one schema object", () => {
    const extra = new RelationsDefinition(users, {
      recentPosts: {
        type: Relation.HAS_MANY,
        target: posts,
        from: [users.columns.id],
        to: [posts.columns.authorId],
      },
    });

    const schema = { users, posts, usersRelations, extra };

    // Merging two `relations()` declarations used to mutate the definition, so the second
    // registry re-merged what the first had already merged and reported a duplicate. Two
    // clients over one schema — an enforcing one and an unscoped one — is ordinary.
    expect(() => new SchemaRegistry(schema)).not.toThrow();
    expect(() => new SchemaRegistry(schema)).not.toThrow();

    expect(Object.keys(new SchemaRegistry(schema).getRelations("users")).sort()).toEqual([
      "posts",
      "recentPosts",
    ]);
  });

  it("still rejects the same relation name declared twice", () => {
    const clash = new RelationsDefinition(users, {
      posts: {
        type: Relation.HAS_MANY,
        target: posts,
        from: [users.columns.id],
        to: [posts.columns.authorId],
      },
    });

    expect(() => new SchemaRegistry({ users, posts, usersRelations, clash })).toThrow(
      /Duplicate relation name: posts/
    );
  });
});

describe("SchemaRegistry.claimKeys", () => {
  const ws = new TenantScopeDefinition({
    workspaceId: new ColumnDefinition("workspace_id", { dataType: "uuid" }).notNull(),
  });

  const workspaces = new TableDefinition("workspaces", {
    columns: { id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey() },
  });

  it("is empty when no table is inside a scope", () => {
    expect(new SchemaRegistry({ workspaces }).claimKeys.size).toBe(0);
  });

  it("collects every claim with the type it is declared with", () => {
    const invoices = ws.table("invoices", {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
    });

    const registry = new SchemaRegistry({ workspaces, invoices });

    expect([...registry.claimKeys.entries()]).toEqual([["workspaceId", "uuid"]]);
  });

  it("records a claim once when several tables declare it", () => {
    const invoices = ws.table("invoices", {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
    });
    const receipts = ws.table("receipts", {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
    });

    expect([...new SchemaRegistry({ invoices, receipts }).claimKeys.keys()]).toEqual([
      "workspaceId",
    ]);
  });

  it("rejects one claim name declared with two types", () => {
    // `$identityClaims` picks claims by name across the whole schema, so one name has to mean
    // one claim — otherwise the identity would be right for one table and wrong for another.
    const other = new TenantScopeDefinition({
      workspaceId: new ColumnDefinition("workspace_id", { dataType: "text" }).notNull(),
    });

    const invoices = ws.table("invoices", {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
    });
    const receipts = other.table("receipts", {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
    });

    expect(() => new SchemaRegistry({ invoices, receipts })).toThrow(
      /Claim "workspaceId" is "uuid" on table "invoices" but "text" on table "receipts"/
    );
  });
});

describe("SchemaRegistry unions", () => {
  const photos = new TableDefinition("photos", {
    columns: {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
      userId: new ColumnDefinition("user_id", { dataType: "uuid" }),
      ownerId: new ColumnDefinition("owner_id", { dataType: "uuid" }),
      createdAt: new ColumnDefinition("created_at", { dataType: "timestamptz" }),
    },
  });

  const videos = new TableDefinition("videos", {
    columns: {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
      userId: new ColumnDefinition("user_id", { dataType: "uuid" }),
      createdAt: new ColumnDefinition("created_at", { dataType: "timestamptz" }),
    },
  });

  const people = new TableDefinition("people", {
    columns: {
      id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
      postType: new ColumnDefinition("post_type", { dataType: "text" }),
      postKind: new ColumnDefinition("post_kind", { dataType: "integer" }),
      postId: new ColumnDefinition("post_id", { dataType: "uuid" }),
    },
  });

  const posts = new UnionDefinition({ photos, videos });

  const relate = (relation: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new RelationsDefinition(people, { rel: relation } as any);

  const feed = (to: unknown) =>
    relate({ type: Relation.HAS_MANY, target: posts, from: [people.columns.id], to });

  const belongsTo = (discriminator?: unknown) =>
    relate({
      type: Relation.BELONGS_TO,
      target: posts,
      from: [people.columns.postId],
      to: [posts.columns.id],
      discriminator,
    });

  it("registers a union under its schema alias with built members", () => {
    const registry = new SchemaRegistry({ photos, videos, posts });
    const union = registry.getUnion("posts");

    expect(union).toBeInstanceOf(Union);
    expect(union.alias).toBe("posts");
    expect(union.memberAliases).toEqual(["photos", "videos"]);
    expect(union.getMember("photos")).toBe(registry.getTable("photos"));
    expect(registry.hasUnion("posts")).toBe(true);
    expect(registry.getUnions().map(([alias]) => alias)).toEqual(["posts"]);
  });

  it("resolves each shared field to the member's runtime column", () => {
    const registry = new SchemaRegistry({ photos, videos, posts });
    const union = registry.getUnion("posts");

    expect(union.getMemberColumn("videos", "createdAt")).toBe(
      registry.getTable("videos").columns.createdAt
    );
    expect(union.isShared("ownerId")).toBe(false);
    expect(() => union.getMemberColumn("photos", "ownerId")).toThrow(/not shared/);
  });

  it("does not register a union as a table", () => {
    const registry = new SchemaRegistry({ photos, videos, posts });

    expect(registry.hasTable("posts")).toBe(false);
    expect(registry.getTableEntries().map(([alias]) => alias)).toEqual(["photos", "videos"]);
  });

  it("rejects a member keyed by something other than its schema alias", () => {
    const pictures = new UnionDefinition({ pictures: photos, videos });

    expect(() => new SchemaRegistry({ photos, videos, pictures })).toThrow(
      /does not export that table as "pictures"/
    );
  });

  it("rejects a member missing from the schema", () => {
    expect(() => new SchemaRegistry({ photos, posts })).toThrow(
      /does not export that table as "videos"/
    );
  });

  it("rejects a union named like a table", () => {
    const named = new TableDefinition("posts", {
      columns: { id: new ColumnDefinition("id").primaryKey() },
    });

    expect(() => new SchemaRegistry({ photos, videos, named, posts })).toThrow(
      /same name as a table/
    );
  });

  it("returns the union as a relation target, with each member's to columns", () => {
    const registry = new SchemaRegistry({
      photos,
      videos,
      people,
      posts,
      rels: feed([posts.columns.userId]),
    });

    expect(registry.getRelationTarget("people", "rel")).toBe(registry.getUnion("posts"));
    expect(registry.getUnionRelationColumns("people", "rel")).toEqual({
      photos: [registry.getTable("photos").columns.userId],
      videos: [registry.getTable("videos").columns.userId],
    });
  });

  it("accepts one to list per member", () => {
    const registry = new SchemaRegistry({
      photos,
      videos,
      people,
      posts,
      rels: feed({ photos: [photos.columns.ownerId], videos: [videos.columns.userId] }),
    });

    expect(registry.getUnionRelationColumns("people", "rel").photos).toEqual([
      registry.getTable("photos").columns.ownerId,
    ]);
  });

  it("rejects a to list that is not made of the union's shared fields", () => {
    expect(
      () =>
        new SchemaRegistry({ photos, videos, people, posts, rels: feed([photos.columns.userId]) })
    ).toThrow(/must be a shared field of union "posts"/);
  });

  it("rejects a per-member map that misses or invents a member", () => {
    expect(
      () =>
        new SchemaRegistry({
          photos,
          videos,
          people,
          posts,
          rels: feed({ photos: [photos.columns.userId], clips: [videos.columns.userId] }),
        })
    ).toThrow(/missing: videos; not members: clips/);
  });

  it("rejects a per-member column declared on another member", () => {
    expect(
      () =>
        new SchemaRegistry({
          photos,
          videos,
          people,
          posts,
          rels: feed({ photos: [videos.columns.userId], videos: [videos.columns.userId] }),
        })
    ).toThrow(/not declared on member "photos"/);
  });

  it("rejects a pair whose types differ on a member", () => {
    expect(
      () =>
        new SchemaRegistry({
          photos,
          videos,
          people,
          posts,
          rels: feed([posts.columns.createdAt]),
        })
    ).toThrow(/"people"."id" is "uuid" but "photos"."createdAt" is "timestamptz"/);
  });

  it("rejects a relation to a union that is not in the schema", () => {
    expect(
      () => new SchemaRegistry({ photos, videos, people, rels: feed([posts.columns.userId]) })
    ).toThrow(/targets union\(photos\|videos\), which is not in the schema/);
  });

  describe("discriminator", () => {
    it("accepts a belongs-to with a text discriminator on the source", () => {
      const registry = new SchemaRegistry({
        photos,
        videos,
        people,
        posts,
        rels: belongsTo(people.columns.postType),
      });

      expect(registry.getRelationTarget("people", "rel")).toBe(registry.getUnion("posts"));
    });

    it("requires one on a belongs-to a union", () => {
      expect(
        () => new SchemaRegistry({ photos, videos, people, posts, rels: belongsTo() })
      ).toThrow(/must declare a discriminator/);
    });

    it("rejects one that is not text-like", () => {
      expect(
        () =>
          new SchemaRegistry({
            photos,
            videos,
            people,
            posts,
            rels: belongsTo(people.columns.postKind),
          })
      ).toThrow(/is "integer"; it holds a member alias/);
    });

    it("rejects one declared on another table", () => {
      expect(
        () =>
          new SchemaRegistry({
            photos,
            videos,
            people,
            posts,
            rels: belongsTo(photos.columns.userId),
          })
      ).toThrow(/discriminator "user_id" is not declared on table "people"/);
    });

    it("rejects one on a has-many to a union", () => {
      const rels = relate({
        type: Relation.HAS_MANY,
        target: posts,
        from: [people.columns.id],
        to: [posts.columns.userId],
        discriminator: people.columns.postType,
      });

      expect(() => new SchemaRegistry({ photos, videos, people, posts, rels })).toThrow(
        /only a belongs-to a union needs one/
      );
    });

    it("rejects one on a relation to a single table", () => {
      const rels = relate({
        type: Relation.BELONGS_TO,
        target: photos,
        from: [people.columns.postId],
        to: [photos.columns.id],
        discriminator: people.columns.postType,
      });

      expect(() => new SchemaRegistry({ photos, videos, people, rels })).toThrow(
        /its target is a single table/
      );
    });
  });
});
