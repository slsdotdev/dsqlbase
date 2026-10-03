import { describe, expect, it } from "vitest";
import { sql, TenancyError } from "@dsqlbase/core";
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

    it("leaves a table that is not a node raw", async () => {
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
      const record = await getClient().$findByGlobalId({ id: wrap("authors", author.id) });

      expect(record?.$$key).toBe("authors");
      expect(record?.$$key === "authors" ? record.name : null).toBe(author.name);
    });

    it("resolves an id straight out of a row", async () => {
      // The round trip that matters: whatever the client handed out, it takes back.
      const article = await getClient().articles.findOne({
        where: { id: { eq: getData().articles[0].id } },
      });

      const record = await getClient().$findByGlobalId({ id: article?.id ?? "" });

      expect(record?.$$key).toBe("articles");
      expect(record?.$$key === "articles" ? record.title : null).toBe(getData().articles[0].title);
    });

    it("reaches a node whose alias differs from its table name", async () => {
      const [revision] = getData().revisions;
      const record = await getClient().$findByGlobalId({ id: wrap("revisions", revision.id) });

      expect(record?.$$key).toBe("revisions");
      expect(record?.$$key === "revisions" ? record.note : null).toBe(revision.note);
    });

    it("applies a per-alias select", async () => {
      const [author] = getData().authors;

      const record = await getClient().$findByGlobalId({
        id: wrap("authors", author.id),
        on: { authors: { select: { name: true } } },
      });

      expect(record).toEqual({
        $$key: "authors",
        $$meta: { key: "authors", table: "authors", __typename: "Author" },
        name: author.name,
      });
    });

    it("returns null for a row that is gone", async () => {
      const [author] = getData().authors;
      const id = wrap("authors", author.id);

      await getClient().$query(sql`DELETE FROM "articles" WHERE "author_id" = ${author.id}`);
      await getClient().$query(sql`DELETE FROM "authors" WHERE "id" = ${author.id}`);

      expect(await getClient().$findByGlobalId({ id })).toBeNull();
    });

    it("refuses an id for a table that is not a node", async () => {
      await expect(
        getClient().$findByGlobalId({ id: encodeGlobalId("tags", { id: getData().authors[0].id }) })
      ).rejects.toThrow(expect.objectContaining({ code: "unknown_node" }));
    });

    it("works inside a transaction", async () => {
      const [author] = getData().authors;

      const record = await getClient().$transaction(async (tx) =>
        tx.$findByGlobalId({ id: wrap("authors", author.id) })
      );

      expect(record?.$$key).toBe("authors");
    });
  });

  describe("$listByGlobalId", () => {
    it("returns rows in the order the ids were given, across tables", async () => {
      const [author] = getData().authors;
      const [article] = getData().articles;
      const [revision] = getData().revisions;

      const records = await getClient().$listByGlobalId({
        ids: [
          wrap("revisions", revision.id),
          wrap("authors", author.id),
          wrap("articles", article.id),
        ],
      });

      expect(records.map((record) => record?.$$key)).toEqual(["revisions", "authors", "articles"]);
    });

    it("keeps the caller's order within one table", async () => {
      // Two rows from one table asked for in the reverse of the order the planner will
      // naturally return them in.
      const [first, second] = getData().authors;

      const records = await getClient().$listByGlobalId({
        ids: [wrap("authors", second.id), wrap("authors", first.id)],
      });

      expect(records.map((record) => (record?.$$key === "authors" ? record.name : null))).toEqual([
        second.name,
        first.name,
      ]);
    });

    // The database finds the row for any spelling of its uuid; matching it back must too.
    it("matches an id whose uuid is spelled in upper case", async () => {
      const [author] = getData().authors;
      const id = wrap("authors", author.id.toUpperCase());

      const [single] = await getClient().$listByGlobalId({ ids: [id] });
      const found = await getClient().$findByGlobalId({ id });

      expect(single?.$$key === "authors" ? single.name : null).toBe(author.name);
      expect(found?.$$key === "authors" ? found.name : null).toBe(author.name);
    });

    it("returns null for a miss, in place", async () => {
      const [author] = getData().authors;
      const missing = wrap("authors", "0f9b6b6a-1111-4222-8333-444444444444");

      const records = await getClient().$listByGlobalId({
        ids: [missing, wrap("authors", author.id), missing],
      });

      expect(records.map((record) => record?.$$key ?? null)).toEqual([null, "authors", null]);
    });

    it("keeps the node key even when select leaves it out", async () => {
      const [author] = getData().authors;

      const records = await getClient().$listByGlobalId({
        ids: [wrap("authors", author.id)],
        on: { authors: { select: { name: true } } },
      });

      const record = records[0];

      expect(record?.$$key === "authors" ? record.id : null).toBe(wrap("authors", author.id));
    });
  });

  describe("tenancy", () => {
    /** A client scoped to the workspace the first seeded draft belongs to. */
    const acme = () =>
      getClient().$identityClaims({ workspaceId: getData().drafts[0].workspaceId });

    it("resolves a node the scoped client owns", async () => {
      const [own] = getData().drafts;
      const record = await acme().$findByGlobalId({ id: wrap("drafts", own.id) });

      expect(record?.$$key === "drafts" ? record.title : null).toBe(own.title);
    });

    it("does not resolve another tenant's node", async () => {
      // The row is there — it was seeded with raw SQL — and the id is a perfectly good one.
      // It comes back `null` because the lookup goes through the model client, so the tenant
      // predicate is in the WHERE. A lookup that issued its own SQL would have returned it.
      const [, other] = getData().drafts;

      expect(await acme().$findByGlobalId({ id: wrap("drafts", other.id) })).toBeNull();

      const [row] = await getClient().$query<{ title: string }>(
        sql`SELECT "title" FROM "drafts" WHERE "id" = ${other.id}`
      );

      expect(row.title).toBe(other.title);
    });

    it("skips another tenant's node in a batch, keeping the rest in place", async () => {
      const [own, other] = getData().drafts;

      const records = await acme().$listByGlobalId({
        ids: [wrap("drafts", other.id), wrap("drafts", own.id)],
      });

      expect(records.map((record) => (record?.$$key === "drafts" ? record.title : null))).toEqual([
        null,
        own.title,
      ]);
    });

    it("refuses a scoped node on a client with no claims", async () => {
      const [own] = getData().drafts;

      await expect(getClient().$findByGlobalId({ id: wrap("drafts", own.id) })).rejects.toThrow(
        TenancyError
      );
    });

    it("refuses an id for a table that is not a node, tenant-scoped or not", async () => {
      const document = getData().documents[0];

      await expect(
        getClient().$findByGlobalId({ id: encodeGlobalId("documents", { id: document.id }) })
      ).rejects.toThrow(expect.objectContaining({ code: "unknown_node" }));
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
