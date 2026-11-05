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
});
