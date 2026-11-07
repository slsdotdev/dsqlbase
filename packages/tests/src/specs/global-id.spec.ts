import { describe, expect, it } from "vitest";
import { sql } from "@dsqlbase/core";
import { decodeGlobalId, encodeGlobalId, isGlobalId } from "dsqlbase";
import { withSeededClient } from "../fixures/seeded-client";

/**
 * Global ids end to end against PGlite.
 *
 * The node tables are seeded through raw SQL, so every id in `getData()` is the **raw** uuid
 * the database holds. That is deliberate: a spec that compared a client's output against
 * another client's output could agree on a wrong answer, whereas comparing against the row
 * actually stored cannot.
 */
describe("global ids", () => {
  const { getClient, getData } = withSeededClient();

  /** The wrapped form of a raw uuid, built without going through the client under test. */
  const wrap = (key: string, id: string) => encodeGlobalId(key, { id });

  describe("reading", () => {
    it("returns the primary key wrapped", async () => {
      const [first] = getData().authors;
      const author = await getClient().authors.findOne({ where: { id: { eq: first.id } } });

      expect(author?.id).toBe(wrap("authors", first.id));
      expect(isGlobalId(author?.id)).toBe(true);
      // The raw uuid is still what the database holds; only the client's view is wrapped.
      expect(author?.id).not.toBe(first.id);
    });

    it("wraps every row of a findMany", async () => {
      const authors = await getClient().authors.findMany({});

      expect(authors).toHaveLength(getData().authors.length);
      expect(authors.every((author) => isGlobalId(author.id))).toBe(true);
    });

    it("wraps a joined row with its own node, not its parent's", async () => {
      const [firstAuthor] = getData().authors;

      const author = await getClient().authors.findOne({
        where: { id: { eq: firstAuthor.id } },
        select: { id: true },
        join: { articles: { select: { id: true, authorId: true } } },
      });

      const article = author?.articles[0];

      expect(article?.id).toBe(wrap("articles", getData().articles[0].id));
      expect(decodeGlobalId(article?.id ?? "").key).toBe("articles");
    });

    it("makes a reference column equal the row it points at", async () => {
      // The promise a keyed guid makes. Without it the application has to unwrap one side
      // before it can compare them.
      const article = await getClient().articles.findOne({
        where: { id: { eq: getData().articles[0].id } },
        select: { id: true, authorId: true },
        join: { author: { select: { id: true } } },
      });

      expect(article?.authorId).toBe(article?.author?.id);
      expect(decodeGlobalId(article?.authorId ?? "").key).toBe("authors");
    });

    it("keys a node by its alias, not its database table name", async () => {
      const revision = await getClient().revisions.findOne({
        where: { id: { eq: getData().revisions[0].id } },
      });

      expect(decodeGlobalId(revision?.id ?? "").key).toBe("revisions");
      expect(revision?.$$meta.table).toBe("article_revisions");
    });

    it("leaves a uuid key raw", async () => {
      const [tag] = await getClient().$query<{ id: string }>(
        sql`INSERT INTO "tags" ("label") VALUES ('raw') RETURNING "id"`
      );

      const found = await getClient().tags.findOne({ where: { id: { eq: tag.id } } });

      expect(found?.id).toBe(tag.id);
      expect(isGlobalId(found?.id)).toBe(false);
    });
  });

  describe("filtering", () => {
    it("accepts a wrapped id", async () => {
      const [first] = getData().authors;
      const author = await getClient().authors.findOne({
        where: { id: { eq: wrap("authors", first.id) } },
      });

      expect(author?.name).toBe(first.name);
    });

    it("accepts a raw uuid", async () => {
      const [first] = getData().authors;
      const author = await getClient().authors.findOne({ where: { id: { eq: first.id } } });

      expect(author?.name).toBe(first.name);
    });

    it("refuses an id from another table", () => {
      // A bare uuid would simply have matched nothing here, which is the failure this replaces.
      // Thrown when the query is *built* — the codec encodes the parameter as the statement is
      // rendered — so the wrong table never reaches the database at all.
      const foreign = wrap("articles", getData().articles[0].id);

      expect(() => getClient().authors.findOne({ where: { id: { eq: foreign } } })).toThrow(
        /Global id names "articles", but "authors" was expected/
      );
    });

    it("matches a reference column filtered by the row it points at", async () => {
      const [firstAuthor] = getData().authors;

      const articles = await getClient().articles.findMany({
        where: { authorId: { eq: wrap("authors", firstAuthor.id) } },
      });

      expect(articles).toHaveLength(2);
    });

    it("accepts a wrapped id inside an `in` list", async () => {
      const [a, b] = getData().articles;

      const articles = await getClient().articles.findMany({
        where: { id: { in: [wrap("articles", a.id), b.id] } },
      });

      expect(articles).toHaveLength(2);
    });
  });

  describe("writing", () => {
    it("wraps the id a create returns, and stores it raw", async () => {
      const created = await getClient().authors.create({
        data: { name: "Katherine Johnson" },
        return: { id: true, name: true },
      });

      expect(isGlobalId(created?.id)).toBe(true);

      const raw = decodeGlobalId(created?.id ?? "").pk.id;
      const [row] = await getClient().$query<{ name: string }>(
        sql`SELECT "name" FROM "authors" WHERE "id" = ${raw}`
      );

      expect(row.name).toBe("Katherine Johnson");
    });

    it("accepts a wrapped id as a foreign key on create", async () => {
      const [author] = getData().authors;

      const created = await getClient().articles.create({
        data: { authorId: wrap("authors", author.id), title: "Written by id" },
        return: { id: true, authorId: true },
      });

      expect(created?.authorId).toBe(wrap("authors", author.id));

      const [row] = await getClient().$query<{ author_id: string }>(
        sql`SELECT "author_id" FROM "articles" WHERE "title" = 'Written by id'`
      );

      // Unwrapped on the way to the database, so the column still holds a real uuid.
      expect(row.author_id).toBe(author.id);
    });

    it("updates and deletes by a wrapped id", async () => {
      const [, second] = getData().articles;
      const id = wrap("articles", second.id);

      const updated = await getClient().articles.update({
        set: { title: "Renamed" },
        where: { id: { eq: id } },
        return: { id: true, title: true },
      });

      expect(updated?.title).toBe("Renamed");
      expect(updated?.id).toBe(id);

      const deleted = await getClient().articles.delete({
        where: { id: { eq: id } },
        return: { id: true },
      });

      expect(deleted?.id).toBe(id);
      expect(await getClient().articles.findOne({ where: { id: { eq: id } } })).toBeNull();
    });
  });

  describe("$findByGlobalId", () => {
    it("reads back the row an id names", async () => {
      const [author] = getData().authors;
      const record = await getClient().$findByGlobalId(wrap("authors", author.id));

      expect(record?.$$key).toBe("authors");
      expect(record?.$$key === "authors" ? record.name : null).toBe(author.name);
    });

    it("resolves an id straight out of a row", async () => {
      // The round trip that matters: whatever the client handed out, it takes back.
      const article = await getClient().articles.findOne({
        where: { id: { eq: getData().articles[0].id } },
      });

      const record = await getClient().$findByGlobalId(article?.id ?? "");

      expect(record?.$$key).toBe("articles");
      expect(record?.$$key === "articles" ? record.title : null).toBe(getData().articles[0].title);
    });

    it("reaches a node whose alias differs from its table name", async () => {
      const [revision] = getData().revisions;
      const record = await getClient().$findByGlobalId(wrap("revisions", revision.id));

      expect(record?.$$key).toBe("revisions");
      expect(record?.$$key === "revisions" ? record.note : null).toBe(revision.note);
    });

    it("reads every column of the row", async () => {
      const [author] = getData().authors;
      const record = await getClient().$findByGlobalId(wrap("authors", author.id));
      const row = await getClient().authors.findOne({ where: { id: { eq: author.id } } });

      expect(record).toEqual({ ...row, $$key: "authors" });
    });

    it("returns null for a row that is gone", async () => {
      const [author] = getData().authors;
      const id = wrap("authors", author.id);

      await getClient().$query(sql`DELETE FROM "articles" WHERE "author_id" = ${author.id}`);
      await getClient().$query(sql`DELETE FROM "authors" WHERE "id" = ${author.id}`);

      expect(await getClient().$findByGlobalId(id)).toBeNull();
    });

    it("reads a composite key", async () => {
      const [article] = getData().articles;
      const [tag] = await getClient().$query<{ id: string }>(
        sql`INSERT INTO "tags" ("label") VALUES ('composite') RETURNING "id"`
      );

      await getClient().$query(
        sql`INSERT INTO "article_tags" ("article_id", "tag_id") VALUES (${article.id}, ${tag.id})`
      );

      const record = await getClient().$findByGlobalId(
        encodeGlobalId("articleTags", { articleId: article.id, tagId: tag.id })
      );

      expect(record).toEqual({
        $$key: "articleTags",
        $$meta: { key: "articleTags", table: "article_tags" },
        articleId: wrap("articles", article.id),
        tagId: tag.id,
      });
    });

    it("reads a uuid-keyed table by its key or by a unique column", async () => {
      const [tag] = await getClient().$query<{ id: string }>(
        sql`INSERT INTO "tags" ("label") VALUES ('by-label') RETURNING "id"`
      );

      const byId = await getClient().$findByGlobalId(encodeGlobalId("tags", { id: tag.id }));
      const byLabel = await getClient().$findByGlobalId(
        encodeGlobalId("tags", { label: "by-label" })
      );

      expect(byId?.$$key === "tags" ? byId.label : null).toBe("by-label");
      expect(byLabel?.$$key === "tags" ? byLabel.id : null).toBe(tag.id);
    });

    it("refuses an id that names no unique key", async () => {
      await expect(
        getClient().$findByGlobalId(encodeGlobalId("nowhere", { id: getData().authors[0].id }))
      ).rejects.toThrow(expect.objectContaining({ code: "unknown_node" }));
      await expect(
        getClient().$findByGlobalId(
          encodeGlobalId("articleTags", { articleId: getData().articles[0].id })
        )
      ).rejects.toThrow(expect.objectContaining({ code: "key_mismatch" }));
    });

    it("works inside a transaction", async () => {
      const [author] = getData().authors;

      const record = await getClient().$transaction(async (tx) =>
        tx.$findByGlobalId(wrap("authors", author.id))
      );

      expect(record?.$$key).toBe("authors");
    });
  });

  describe("$listByGlobalId", () => {
    it("returns rows in the order the ids were given, across tables", async () => {
      const [author] = getData().authors;
      const [article] = getData().articles;
      const [revision] = getData().revisions;

      const records = await getClient().$listByGlobalId([
        wrap("revisions", revision.id),
        wrap("authors", author.id),
        wrap("articles", article.id),
      ]);

      expect(records.map((record) => record?.$$key)).toEqual(["revisions", "authors", "articles"]);
    });

    it("keeps the caller's order within one table", async () => {
      // Two rows from one table asked for in the reverse of the order the planner will
      // naturally return them in.
      const [first, second] = getData().authors;

      const records = await getClient().$listByGlobalId([
        wrap("authors", second.id),
        wrap("authors", first.id),
      ]);

      expect(records.map((record) => (record?.$$key === "authors" ? record.name : null))).toEqual([
        second.name,
        first.name,
      ]);
    });

    // The database finds the row for any spelling of its uuid; matching it back must too.
    it("matches an id whose uuid is spelled in upper case", async () => {
      const [author] = getData().authors;
      const id = wrap("authors", author.id.toUpperCase());

      const [single] = await getClient().$listByGlobalId([id]);
      const found = await getClient().$findByGlobalId(id);

      expect(single?.$$key === "authors" ? single.name : null).toBe(author.name);
      expect(found?.$$key === "authors" ? found.name : null).toBe(author.name);
    });

    it("reads every column of each row, with null for a miss in place", async () => {
      const [first, second] = getData().authors;
      const missing = wrap("authors", "0f9b6b6a-1111-4222-8333-444444444444");
      const rows = await getClient().authors.findMany({
        where: { id: { in: [first.id, second.id] } },
      });
      const rowOf = (id: string) => rows.find((row) => row.id === wrap("authors", id));

      const records = await getClient().$listByGlobalId([
        wrap("authors", first.id),
        missing,
        wrap("authors", second.id),
      ]);

      expect(records).toEqual([
        { ...rowOf(first.id), $$key: "authors" },
        null,
        { ...rowOf(second.id), $$key: "authors" },
      ]);
    });

    it("matches composite keys back in place beside single ones", async () => {
      const [first, second] = getData().articles;
      const [tag] = await getClient().$query<{ id: string }>(
        sql`INSERT INTO "tags" ("label") VALUES ('batch') RETURNING "id"`
      );

      await getClient().$query(
        sql`INSERT INTO "article_tags" ("article_id", "tag_id") VALUES (${first.id}, ${tag.id})`
      );

      const records = await getClient().$listByGlobalId([
        encodeGlobalId("articleTags", { articleId: second.id, tagId: tag.id }),
        wrap("articles", first.id),
        // Upper case: matched back by canonical value, not by the id's text.
        encodeGlobalId("articleTags", { articleId: first.id, tagId: tag.id.toUpperCase() }),
      ]);

      expect(records.map((record) => record?.$$key ?? null)).toEqual([
        null,
        "articles",
        "articleTags",
      ]);
    });

    it("returns null for a miss, in place", async () => {
      const [author] = getData().authors;
      const missing = wrap("authors", "0f9b6b6a-1111-4222-8333-444444444444");

      const records = await getClient().$listByGlobalId([
        missing,
        wrap("authors", author.id),
        missing,
      ]);

      expect(records.map((record) => record?.$$key ?? null)).toEqual([null, "authors", null]);
    });
  });

  describe("migrations", () => {
    it("emits a guid column as a plain uuid", async () => {
      const [column] = await getClient().$query<{ data_type: string }>(sql`
        SELECT "data_type" FROM "information_schema"."columns"
        WHERE "table_name" = 'authors' AND "column_name" = 'id'
      `);

      expect(column.data_type).toBe("uuid");
    });
  });
});
