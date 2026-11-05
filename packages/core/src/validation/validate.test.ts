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
