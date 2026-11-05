import { describe, expect, it, vi } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
  UnionDefinition,
} from "../definition/index.js";
import { ExecutionContext } from "./context.js";
import { OperationsFactory } from "./operation.js";
import { QueryBuilder } from "./query.js";
import { ComputedDiscriminator } from "./reference.js";
import { SchemaRegistry } from "./registry.js";

const col = (name: string, dataType = "text") => new ColumnDefinition(name, { dataType });

const authors = new TableDefinition("authors", {
  columns: { id: col("id", "uuid").primaryKey() },
});

const articles = new TableDefinition("articles", {
  columns: {
    id: col("id", "uuid").primaryKey(),
    authorId: col("author_id", "uuid"),
  },
});

const photos = new TableDefinition("photos", {
  columns: { id: col("id", "uuid").primaryKey(), authorId: col("author_id", "uuid") },
});

const videos = new TableDefinition("videos", {
  columns: { id: col("id", "uuid").primaryKey(), authorId: col("author_id", "uuid") },
});

const posts = new UnionDefinition(
  { photos, videos },
  { id: col("id", "uuid"), authorId: col("author_id", "uuid") }
);

const comments = new TableDefinition("comments", {
  columns: {
    id: col("id", "uuid").primaryKey(),
    targetType: col("target_type"),
    targetId: col("target_id", "uuid"),
  },
});

const belongsToAuthor = {
  type: Relation.BELONGS_TO,
  target: authors,
  from: [articles.columns.authorId],
  to: [authors.columns.id],
} as const;

describe("column references", () => {
  it("sets a belongs-to's reference on its `from` column", () => {
    const schema = new SchemaRegistry({
      authors,
      articles,
      rels: new RelationsDefinition(articles, { author: belongsToAuthor }),
    });
    const authorId = schema.getTable("articles").columns.authorId;

    expect(authorId.references).toEqual([
      {
        kind: "table",
        column: schema.getTable("authors").columns.id,
        via: { table: schema.getTable("articles"), field: "author" },
      },
    ]);
    expect(schema.getTable("authors").columns.id.references).toEqual([]);
  });

  // The foreign key is on the target, so a has-many declared on authors writes onto articles.
  it("sets a has-many's reference on the target's `to` column", () => {
    const schema = new SchemaRegistry({
      authors,
      articles,
      rels: new RelationsDefinition(authors, {
        articles: {
          type: Relation.HAS_MANY,
          target: articles,
          from: [authors.columns.id],
          to: [articles.columns.authorId],
        },
      }),
    });

    expect(schema.getTable("articles").columns.authorId.references).toMatchObject([
      { kind: "table", column: schema.getTable("authors").columns.id },
    ]);
    expect(schema.getTable("authors").columns.id.references).toEqual([]);
  });

  it("records a reference declared on both sides once", () => {
    const schema = new SchemaRegistry({
      authors,
      articles,
      a: new RelationsDefinition(articles, { author: belongsToAuthor }),
      b: new RelationsDefinition(authors, {
        articles: {
          type: Relation.HAS_MANY,
          target: articles,
          from: [authors.columns.id],
          to: [articles.columns.authorId],
        },
      }),
    });

    expect(schema.getTable("articles").columns.authorId.references).toHaveLength(1);
  });

  it("sets a has-many to a union on every member's column", () => {
    const schema = new SchemaRegistry({
      authors,
      photos,
      videos,
      posts,
      rels: new RelationsDefinition(authors, {
        posts: {
          type: Relation.HAS_MANY,
          target: posts,
          from: [authors.columns.id],
          to: [posts.columns.authorId],
        },
      }),
    });
    const id = schema.getTable("authors").columns.id;

    expect(schema.getTable("photos").columns.authorId.references).toMatchObject([
      { kind: "table", column: id },
    ]);
    expect(schema.getTable("videos").columns.authorId.references).toMatchObject([
      { kind: "table", column: id },
    ]);
  });

  describe("belongs-to a union", () => {
    const schema = new SchemaRegistry({
      photos,
      videos,
      posts,
      comments,
      rels: new RelationsDefinition(comments, {
        target: {
          type: Relation.BELONGS_TO,
          target: posts,
          from: [comments.columns.targetId],
          to: [posts.columns.id],
          discriminator: comments.columns.targetType,
        },
      }),
    });
    const table = schema.getTable("comments");
    const targetId = table.columns.targetId;
    const photoId = schema.getTable("photos").columns.id;
    const videoId = schema.getTable("videos").columns.id;

    it("points at the union's members, through the discriminator", () => {
      expect(targetId.references).toEqual([
        {
          kind: "union",
          union: schema.getUnion("posts"),
          members: { photos: photoId, videos: videoId },
          discriminator: table.columns.targetType,
          via: { table, field: "target" },
        },
      ]);
      expect(targetId.dependsOn).toEqual([table.columns.targetType]);
    });

    it("ends at the union without a row, and at the named member with one", () => {
      expect(targetId.resolveReferences().ends).toEqual([
        { kind: "union", reference: targetId.references[0] },
      ]);
      expect(targetId.resolveReferences({ target_type: "videos" }).ends).toEqual([
        { kind: "table", column: videoId },
      ]);
      expect(targetId.resolveReferences({ target_type: "nope" }).ends).toEqual([]);
      expect(targetId.resolveReferences({ target_type: null }).ends).toEqual([]);
    });

    // A plain-uuid key projects its discriminator too: dependencies are never gated on type.
    it("projects the discriminator with the column", () => {
      const { query } = new OperationsFactory(
        new ExecutionContext({ schema, dialect: new QueryBuilder(), session: { execute: vi.fn() } })
      ).createSelectOperation(table, {
        mode: "many",
        args: { select: [["targetId", targetId]] },
      });

      expect(query.text).toBe(
        'SELECT "__t0"."target_id", "__t0"."target_type" FROM "comments" AS "__t0"'
      );
    });
  });

  describe("resolveReferences", () => {
    const customers = new TableDefinition("customers", {
      columns: { id: col("id", "uuid").primaryKey() },
    });
    const orders = new TableDefinition("orders", {
      columns: { id: col("id", "uuid").primaryKey(), customerId: col("customer_id", "uuid") },
    });
    const stats = new TableDefinition("customer_stats", {
      columns: { customerId: col("customer_id", "uuid").primaryKey() },
    });
    const other = new TableDefinition("other", {
      columns: { id: col("id", "uuid").primaryKey() },
    });

    it("ends at itself with no references", () => {
      const schema = new SchemaRegistry({ customers });
      const id = schema.getTable("customers").columns.id;

      expect(id.resolveReferences()).toEqual({ ends: [{ kind: "table", column: id }] });
    });

    // orders.customerId → customers.id and → customerStats.customerId → customers.id
    it("compares chains by where they end", () => {
      const schema = new SchemaRegistry({
        customers,
        orders,
        stats,
        a: new RelationsDefinition(orders, {
          customer: {
            type: Relation.BELONGS_TO,
            target: customers,
            from: [orders.columns.customerId],
            to: [customers.columns.id],
          },
          stats: {
            type: Relation.BELONGS_TO,
            target: stats,
            from: [orders.columns.customerId],
            to: [stats.columns.customerId],
          },
        }),
        b: new RelationsDefinition(stats, {
          customer: {
            type: Relation.BELONGS_TO,
            target: customers,
            from: [stats.columns.customerId],
            to: [customers.columns.id],
          },
        }),
      });
      const customerId = schema.getTable("orders").columns.customerId;

      expect(customerId.references).toHaveLength(2);
      expect(customerId.resolveReferences()).toEqual({
        ends: [{ kind: "table", column: schema.getTable("customers").columns.id }],
      });
    });

    it("reports two ends without throwing", () => {
      const schema = new SchemaRegistry({
        customers,
        orders,
        other,
        rels: new RelationsDefinition(orders, {
          customer: {
            type: Relation.BELONGS_TO,
            target: customers,
            from: [orders.columns.customerId],
            to: [customers.columns.id],
          },
          other: {
            type: Relation.BELONGS_TO,
            target: other,
            from: [orders.columns.customerId],
            to: [other.columns.id],
          },
        }),
      });

      expect(schema.getTable("orders").columns.customerId.resolveReferences().ends).toEqual([
        { kind: "table", column: schema.getTable("customers").columns.id },
        { kind: "table", column: schema.getTable("other").columns.id },
      ]);
    });

    it("reports a ring without throwing", () => {
      const schema = new SchemaRegistry({
        orders,
        stats,
        a: new RelationsDefinition(orders, {
          stats: {
            type: Relation.BELONGS_TO,
            target: stats,
            from: [orders.columns.customerId],
            to: [stats.columns.customerId],
          },
        }),
        b: new RelationsDefinition(stats, {
          order: {
            type: Relation.BELONGS_TO,
            target: orders,
            from: [stats.columns.customerId],
            to: [orders.columns.customerId],
          },
        }),
      });
      const customerId = schema.getTable("orders").columns.customerId;
      const statsId = schema.getTable("customer_stats").columns.customerId;

      expect(customerId.resolveReferences()).toEqual({
        ends: [],
        ring: [customerId, statsId, customerId],
      });
    });
  });

  it("fixes references once the registry is built", () => {
    const schema = new SchemaRegistry({ authors });
    const id = schema.getTable("authors").columns.id;

    expect(() =>
      id._addReference({
        kind: "table",
        column: id,
        via: { table: schema.getTable("authors"), field: "x" },
      })
    ).toThrow(/already built; its references are fixed/);
  });

  describe("belongs-to a union without a discriminator", () => {
    const notes = new TableDefinition("notes", {
      columns: { id: col("id", "uuid").primaryKey(), postId: col("post_id", "uuid") },
    });
    const schema = new SchemaRegistry({
      photos,
      videos,
      posts,
      notes,
      rels: new RelationsDefinition(notes, {
        post: {
          type: Relation.BELONGS_TO,
          target: posts,
          from: [notes.columns.postId],
          to: [posts.columns.id],
        },
      }),
    });
    const table = schema.getTable("notes");
    const factory = new OperationsFactory(
      new ExecutionContext({ schema, dialect: new QueryBuilder(), session: { execute: vi.fn() } })
    );
    const probe =
      `CASE WHEN EXISTS (SELECT 1 FROM "photos" AS "__d0" WHERE "__d0"."id" = "__t0"."post_id") ` +
      `THEN 'photos' WHEN EXISTS (SELECT 1 FROM "videos" AS "__d1" WHERE "__d1"."id" = ` +
      `"__t0"."post_id") THEN 'videos' END`;

    it("references the union through a computed discriminator", () => {
      const [reference] = table.columns.postId.references;

      expect(reference).toMatchObject({ kind: "union", union: schema.getUnion("posts") });
      expect(reference.kind === "union" && reference.discriminator).toBeInstanceOf(
        ComputedDiscriminator
      );
      expect(table.columns.postId.dependsOn).toEqual([
        reference.kind === "union" && reference.discriminator,
      ]);
    });

    it("projects the computed discriminator under the key's name", () => {
      const { query } = factory.createSelectOperation(table, {
        mode: "many",
        args: { select: [["postId", table.columns.postId]] },
      });

      expect(query.text).toBe(
        `SELECT "__t0"."post_id", ${probe} AS "post_id$key" FROM "notes" AS "__t0"`
      );
    });

    // Each branch matches only the member the probe picks, so an id held by both members joins
    // the first one, as the projected discriminator reads it.
    it("correlates each branch on the member the probe picks", () => {
      const { query } = factory.createSelectOperation(table, {
        mode: "many",
        args: {
          select: [["id", table.columns.id]],
          join: [
            [
              "post",
              {
                members: [
                  ["photos", {}],
                  ["videos", {}],
                ],
              },
            ],
          ],
        },
      });

      expect(query.text).toContain(
        `FROM "photos" AS "__t1" WHERE "__t1"."id" = "__t0"."post_id" AND ${probe} = 'photos'`
      );
    });
  });

  describe("a union as the source of a relation", () => {
    const notes = new TableDefinition("notes", {
      columns: { id: col("id", "uuid").primaryKey(), postId: col("post_id", "uuid") },
    });
    const postNotes = (relation: Partial<Record<string, unknown>> = {}) =>
      new RelationsDefinition(posts, {
        notes: {
          type: Relation.HAS_MANY,
          target: notes,
          from: [posts.columns.id],
          to: [notes.columns.postId],
          ...relation,
        },
      } as never);
    const schema = new SchemaRegistry({ photos, videos, posts, notes, rels: postNotes() });
    const factory = new OperationsFactory(
      new ExecutionContext({ schema, dialect: new QueryBuilder(), session: { execute: vi.fn() } })
    );

    it("gives every member the relation, from its own column", () => {
      expect(schema.getTable("photos").getRelation("notes")?.from).toEqual([photos.columns.id]);
      expect(schema.getTable("videos").getRelation("notes")?.from).toEqual([videos.columns.id]);
    });

    it("sets one union reference on the foreign key", () => {
      const postId = schema.getTable("notes").columns.postId;

      expect(postId.references).toHaveLength(1);
      expect(postId.references[0]).toMatchObject({
        kind: "union",
        union: schema.getUnion("posts"),
        members: {
          photos: schema.getTable("photos").columns.id,
          videos: schema.getTable("videos").columns.id,
        },
        via: { table: schema.getUnion("posts"), field: "notes" },
      });
      expect(postId.dependsOn[0]).toBeInstanceOf(ComputedDiscriminator);
    });

    // The has-many from the union and the belongs-to back are one reference, one probe.
    it("shares one reference with a belongs-to back to the union", () => {
      const both = new SchemaRegistry({
        photos,
        videos,
        posts,
        notes,
        rels: postNotes(),
        back: new RelationsDefinition(notes, {
          post: {
            type: Relation.BELONGS_TO,
            target: posts,
            from: [notes.columns.postId],
            to: [posts.columns.id],
          },
        }),
      });
      const postId = both.getTable("notes").columns.postId;

      expect(postId.references).toHaveLength(1);
      expect(postId.dependsOn).toHaveLength(1);
      expect(both.getRelationDiscriminator("notes", "post")).toBe(postId.dependsOn[0]);
    });

    // A stored discriminator on the belongs-to back is honoured: no second, computed one.
    it("shares a stored discriminator declared on the belongs-to back", () => {
      const tagged = new TableDefinition("tagged_notes", {
        columns: {
          id: col("id", "uuid").primaryKey(),
          postType: col("post_type"),
          postId: col("post_id", "uuid"),
        },
      });
      const both = new SchemaRegistry({
        photos,
        videos,
        posts,
        tagged,
        rels: new RelationsDefinition(posts, {
          notes: {
            type: Relation.HAS_MANY,
            target: tagged,
            from: [posts.columns.id],
            to: [tagged.columns.postId],
          },
        } as never),
        back: new RelationsDefinition(tagged, {
          post: {
            type: Relation.BELONGS_TO,
            target: posts,
            from: [tagged.columns.postId],
            to: [posts.columns.id],
            discriminator: tagged.columns.postType,
          },
        }),
      });
      const table = both.getTable("tagged_notes");

      expect(table.columns.postId.references).toHaveLength(1);
      expect(table.columns.postId.dependsOn).toEqual([table.columns.postType]);
    });

    it("joins from each union branch through its member", () => {
      const { query } = factory.createUnionSelectOperation(schema.getUnion("posts"), {
        mode: "many",
        args: {
          members: [
            ["photos", { join: [["notes", { select: [] }]] }],
            ["videos", { join: [["notes", { select: [] }]] }],
          ],
        },
      });

      expect(query.text).toContain(`FROM "notes" AS "__t1" WHERE "__t1"."post_id" = "__t0"."id"`);
      expect(query.text).toContain(`FROM "notes" AS "__t3" WHERE "__t3"."post_id" = "__t2"."id"`);
    });

    it("refuses a union target", () => {
      expect(
        () =>
          new SchemaRegistry({
            photos,
            videos,
            posts,
            rels: new RelationsDefinition(posts, {
              self: {
                type: Relation.HAS_MANY,
                target: posts,
                from: [posts.columns.id],
                to: [posts.columns.id],
              },
            } as never),
          })
      ).toThrow(/must target a table/);
    });

    it("refuses a discriminator", () => {
      expect(
        () =>
          new SchemaRegistry({
            photos,
            videos,
            posts,
            notes,
            rels: postNotes({ discriminator: notes.columns.id }),
          })
      ).toThrow(/declares a discriminator/);
    });

    it("refuses a from column the union does not declare", () => {
      expect(
        () =>
          new SchemaRegistry({
            photos,
            videos,
            posts,
            notes,
            rels: postNotes({ from: [photos.columns.id] }),
          })
      ).toThrow(/must be a field the union declares/);
    });

    it("refuses a name a member already uses for a relation", () => {
      expect(
        () =>
          new SchemaRegistry({
            photos,
            videos,
            posts,
            notes,
            own: new RelationsDefinition(photos, {
              notes: {
                type: Relation.HAS_MANY,
                target: notes,
                from: [photos.columns.id],
                to: [notes.columns.postId],
              },
            }),
            rels: postNotes(),
          })
      ).toThrow(/Duplicate relation name: notes|same name as relation "notes"/);
    });
  });
});
