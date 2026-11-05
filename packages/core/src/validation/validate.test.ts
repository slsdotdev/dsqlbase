import { describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
  UnionDefinition,
} from "../definition/index.js";
import { collectRelations, validateSchema } from "./validate.js";

const col = (name: string, dataType = "uuid") => new ColumnDefinition(name, { dataType });

const authors = new TableDefinition("authors", { columns: { id: col("id").primaryKey() } });
const articles = new TableDefinition("articles", {
  columns: { id: col("id").primaryKey(), authorId: col("author_id"), oldId: col("old_id") },
});
const author = (from = articles.columns.authorId) =>
  new RelationsDefinition(articles, {
    author: { type: Relation.BELONGS_TO, target: authors, from: [from], to: [authors.columns.id] },
  });

describe("validateSchema", () => {
  it("accepts a valid schema and changes nothing", () => {
    const rels = author();
    const before = { ...rels.relations };

    expect(() => validateSchema({ authors, articles, rels })).not.toThrow();
    expect(rels.relations).toEqual(before);
  });

  it("refuses a relation through a deprecated column", () => {
    const legacy = new TableDefinition("articles", {
      columns: {
        id: col("id").primaryKey(),
        authorId: col("author_id").deprecated(),
      },
    });
    const rels = new RelationsDefinition(legacy, {
      author: {
        type: Relation.BELONGS_TO,
        target: authors,
        from: [legacy.columns.authorId],
        to: [authors.columns.id],
      },
    });

    expect(() => validateSchema({ authors, legacy, rels })).toThrow(
      /"articles"."authorId" is deprecated/
    );
  });

  it("refuses a pair whose types differ", () => {
    const textId = new TableDefinition("articles", {
      columns: { id: col("id").primaryKey(), authorId: col("author_id", "text") },
    });
    const rels = new RelationsDefinition(textId, {
      author: {
        type: Relation.BELONGS_TO,
        target: authors,
        from: [textId.columns.authorId],
        to: [authors.columns.id],
      },
    });

    expect(() => validateSchema({ authors, textId, rels })).toThrow(
      /"articles"."authorId" is "text" but "authors"."id" is "uuid"/
    );
  });
});

describe("collectRelations", () => {
  const photos = new TableDefinition("photos", { columns: { id: col("id").primaryKey() } });
  const videos = new TableDefinition("videos", { columns: { id: col("id").primaryKey() } });
  const posts = new UnionDefinition({ photos, videos }, { id: col("id") });
  const notes = new TableDefinition("notes", {
    columns: { id: col("id").primaryKey(), postId: col("post_id") },
  });
  const onUnion = new RelationsDefinition(posts, {
    notes: {
      type: Relation.HAS_MANY,
      target: notes,
      from: [posts.columns.id],
      to: [notes.columns.postId],
    },
  } as never);

  it("gives every member a relation declared on its union, from its own columns", () => {
    const relations = collectRelations({ photos, videos, posts, notes, onUnion });

    expect(relations.map((r) => [r.source.name, r.member, r.relation.from])).toEqual([
      ["photos", "photos", [photos.columns.id]],
      ["videos", "videos", [videos.columns.id]],
    ]);
  });

  it("refuses a name a member already has, whichever is declared first", () => {
    const own = new RelationsDefinition(photos, {
      notes: {
        type: Relation.HAS_MANY,
        target: notes,
        from: [photos.columns.id],
        to: [notes.columns.postId],
      },
    });
    const message =
      /Relation "notes" on union\(photos\|videos\) has the same name as relation "notes" on its member "photos"/;

    expect(() => collectRelations({ photos, videos, posts, notes, own, onUnion })).toThrow(message);
    expect(() => collectRelations({ photos, videos, posts, notes, onUnion, own })).toThrow(message);
  });
});

describe("validateSchema — references", () => {
  const hooks = { read: (value: unknown) => value };
  const hooked = (name: string) => new ColumnDefinition(name, { dataType: "uuid", hooks });
  const belongsTo = (
    source: TableDefinition<string, Record<string, ColumnDefinition<string, never>>>,
    target: TableDefinition<string, Record<string, ColumnDefinition<string, never>>>,
    from: ColumnDefinition<string, never>,
    to: ColumnDefinition<string, never>
  ) => ({ type: Relation.BELONGS_TO, target, from: [from], to: [to] }) as never;

  it("refuses a ring of references, for any column", () => {
    const orders = new TableDefinition("orders", {
      columns: { id: col("id").primaryKey(), customerId: col("customer_id") },
    });
    const stats = new TableDefinition("stats", {
      columns: { customerId: col("customer_id") },
    });
    const a = new RelationsDefinition(orders, {
      stats: belongsTo(orders, stats, orders.columns.customerId, stats.columns.customerId),
    });
    const b = new RelationsDefinition(stats, {
      order: belongsTo(stats, orders, stats.columns.customerId, orders.columns.customerId),
    });

    expect(() => validateSchema({ orders, stats, a, b })).toThrow(
      'Columns "orders.customerId" → "stats.customerId" → "orders.customerId" reference each ' +
        "other in a ring"
    );
  });

  it("refuses a pair whose columns carry different hooks", () => {
    const people = new TableDefinition("people", { columns: { id: hooked("id").primaryKey() } });
    const posts = new TableDefinition("posts", {
      columns: { id: hooked("id").primaryKey(), personId: col("person_id") },
    });
    const rels = new RelationsDefinition(posts, {
      person: belongsTo(posts, people, posts.columns.personId, people.columns.id),
    });

    expect(() => validateSchema({ people, posts, rels })).toThrow(
      /pairs "posts"."personId" and "people"."id", but they carry different column hooks/
    );
  });

  it("lets a plain column reference two targets, but not a column with hooks", () => {
    const build = (column: (name: string) => ColumnDefinition<string, never>) => {
      const users = new TableDefinition("users", { columns: { id: column("id").primaryKey() } });
      const teams = new TableDefinition("teams", { columns: { id: column("id").primaryKey() } });
      const notes = new TableDefinition("notes", {
        columns: { id: column("id").primaryKey(), ownerId: column("owner_id") },
      });
      const rels = new RelationsDefinition(notes, {
        user: belongsTo(notes, users, notes.columns.ownerId, users.columns.id),
        team: belongsTo(notes, teams, notes.columns.ownerId, teams.columns.id),
      });

      return () => validateSchema({ users, teams, notes, rels });
    };

    expect(build((name) => col(name) as ColumnDefinition<string, never>)).not.toThrow();
    expect(build((name) => hooked(name) as ColumnDefinition<string, never>)).toThrow(
      'Column "notes.ownerId" is paired by relation "user" on table "notes" with "users.id" ' +
        'and by relation "team" on table "notes" with "teams.id".'
    );
  });

  describe("a column with hooks pointing at a union", () => {
    const fixture = (memberKey: (name: string) => ColumnDefinition<string, never>) => {
      const photos = new TableDefinition("photos", {
        columns: { id: hooked("id").primaryKey(), ref: memberKey("ref") },
      });
      const videos = new TableDefinition("videos", {
        columns: { id: hooked("id").primaryKey(), ref: memberKey("ref") },
      });
      const media = new UnionDefinition({ photos, videos }, { ref: hooked("ref") });
      const comments = new TableDefinition("comments", {
        columns: {
          id: col("id").primaryKey(),
          mediaType: col("media_type", "text"),
          mediaRef: hooked("media_ref"),
        },
      });
      const rels = new RelationsDefinition(comments, {
        media: {
          type: Relation.BELONGS_TO,
          target: media,
          from: [comments.columns.mediaRef],
          to: [media.columns.ref],
          discriminator: comments.columns.mediaType,
        },
      });
      // A member's has-many onto the same column agrees with the union reference.
      const photoRels = new RelationsDefinition(photos, {
        comments: {
          type: Relation.HAS_MANY,
          target: comments,
          from: [photos.columns.ref],
          to: [comments.columns.mediaRef],
        },
      });

      return () => validateSchema({ photos, videos, media, comments, rels, photoRels });
    };

    it("accepts members reached through a unique key, and a member's relation agreeing", () => {
      expect(
        fixture((name) => hooked(name).unique() as unknown as ColumnDefinition<string, never>)
      ).not.toThrow();
    });

    it("refuses a member reached through a column that is not a unique key", () => {
      expect(fixture((name) => hooked(name) as ColumnDefinition<string, never>)).toThrow(
        /"photos.ref" is not a unique key of union member "photos"/
      );
    });
  });
});
