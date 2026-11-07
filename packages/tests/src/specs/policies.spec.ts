import { describe, expect, it } from "vitest";
import { sql } from "@dsqlbase/core";
import { createClient, encodeGlobalId, PolicyViolationError } from "dsqlbase";
import { withSeededClient } from "../fixures/seeded-client";
import { schema } from "../db/schema";
import { params } from "../db/schema/settings";

/**
 * Row policies, end to end against PGlite.
 *
 * Both workspaces are seeded through raw SQL, so the other workspace's rows are genuinely there
 * and a leak would show as data rather than as an error. Every assertion is about what a client
 * with settings can reach, never about what it was asked for.
 *
 * `documents`: restrictive `workspace_isolation`, `members_read` (select), `members_insert`
 * (insert as the author), `author_writes` (update / delete by the author).
 * `document_comments`: one permissive `workspace_isolation`. `drafts`: `workspace_isolation` for
 * select, insert and delete — no update policy.
 */
describe("row policies", () => {
  const { getClient, getData } = withSeededClient();

  /** Alice's view: the first workspace, as the first user — author of "Acme roadmap". */
  const acme = () =>
    getClient().$settings({
      workspaceId: getData().workspaces[0].id,
      userId: getData().users[0].id,
    });

  /** A second client over the same database that skips every policy, to look behind them. */
  const internal = () =>
    createClient({
      schema,
      session: getClient().session,
      settings: params,
      policies: { bypass: true },
    });

  const foreignDocument = () =>
    getData().documents.find((d) => d.workspaceId === getData().workspaces[1].id);

  describe("reads", () => {
    it("findMany returns only the workspace's rows", async () => {
      const data = getData();

      const documents = await acme().documents.findMany({});

      expect(documents.map((d) => d.workspaceId)).toEqual([
        data.workspaces[0].id,
        data.workspaces[0].id,
      ]);
      expect(documents.map((d) => d.title).sort()).toEqual(["Acme onboarding", "Acme roadmap"]);
    });

    it("findOne cannot reach another workspace's row by its primary key", async () => {
      const result = await acme().documents.findOne({ where: { id: foreignDocument()?.id ?? "" } });

      expect(result).toBeNull();
    });

    it("a where on the policy's column cannot widen what is visible", async () => {
      const documents = await acme().documents.findMany({
        where: { workspaceId: getData().workspaces[1].id },
      });

      expect(documents).toEqual([]);
    });

    it("bounds a joined level reached from a table without policies", async () => {
      const workspaces = await acme().workspaces.findMany({
        select: { id: true },
        join: { documents: { select: { id: true } } },
      });

      const globex = workspaces.find((w) => w.id === getData().workspaces[1].id);

      // The parent has no policy, so it is visible; its documents are not.
      expect(globex).toBeDefined();
      expect(globex?.documents).toEqual([]);
    });

    it("bounds a join that correlates on something other than the policy's column", async () => {
      // `users` has no policy and the correlation is on author_id, so nothing but the policy
      // keeps the other workspace's document — by the same author — out.
      const authors = await acme().users.findMany({
        where: { id: getData().users[0].id },
        select: { id: true, authoredDocuments: { title: true } },
      });

      expect(authors[0]?.authoredDocuments.map((d) => d.title)).toEqual(["Acme roadmap"]);
    });

    it("bounds the second nested level as well as the first", async () => {
      const workspaces = await acme().workspaces.findMany({
        select: { id: true },
        join: {
          documents: {
            select: { id: true },
            join: { comments: { select: { author: true } } },
          },
        },
      });

      const own = workspaces.find((w) => w.id === getData().workspaces[0].id);
      const authors = own?.documents.flatMap((d) => d.comments.map((c) => c.author));

      expect(authors?.sort()).toEqual(["alice", "alice", "bob"]);
      expect(authors).not.toContain("carol");
    });

    it("bounds the member of a union join that has policies, and not the other", async () => {
      const feed = await acme().users.findOne({
        where: { id: { eq: getData().users[0].id } },
        select: { feed: { title: true } },
      });

      expect(
        feed?.feed.filter((item) => item.$$key === "documents").map((item) => item.title)
      ).toEqual(["Acme roadmap"]);
      expect(feed?.feed.some((item) => item.$$key === "bookmarks")).toBe(true);
    });

    it("bounds the member on the union client, its count and its pages", async () => {
      const data = getData();
      const own = data.documents.filter((d) => d.workspaceId === data.workspaces[0].id);
      const expected = own.length + data.bookmarks.length;

      const rows = await acme().userFeed.findMany({});
      const count = await acme().userFeed.count();
      const page = await acme().userFeed.paginate({ limit: 100 });

      expect(
        rows
          .filter((row) => row.$$key === "documents")
          .map((row) => row.title)
          .sort()
      ).toEqual(own.map((d) => d.title).sort());
      expect(rows).toHaveLength(expected);
      expect(count).toBe(expected);
      expect(page.items).toHaveLength(expected);
    });

    it("bounds a node lookup, which goes through the model client", async () => {
      const [own, foreign] = getData().drafts;

      const found = await acme().$listByGlobalId([
        encodeGlobalId("drafts", { id: own?.id ?? "" }),
        encodeGlobalId("drafts", { id: foreign?.id ?? "" }),
      ]);

      expect(found.map((record) => (record?.$$key === "drafts" ? record.title : null))).toEqual([
        "Acme draft",
        null,
      ]);
    });
  });

  describe("unset settings", () => {
    it("a client without settings reads nothing from a table with policies", async () => {
      await expect(getClient().documents.findMany({})).resolves.toEqual([]);
      await expect(getClient().documents.count()).resolves.toBe(0);
    });

    it("a setting left out hides what a policy over it bounds", async () => {
      const noWorkspace = getClient().$settings({ userId: getData().users[0].id });

      await expect(noWorkspace.documents.findMany({})).resolves.toEqual([]);
    });

    it("an unset setting a column is filled from is refused by NOT NULL", async () => {
      const noWorkspace = getClient().$settings({ userId: getData().users[0].id });

      await expect(
        noWorkspace.documents.create({ data: { title: "orphan", authorId: getData().users[0].id } })
      ).rejects.toMatchObject({ code: "23502" });
    });

    it("an unset setting a check reads fails the check", async () => {
      const noUser = getClient().$settings({ workspaceId: getData().workspaces[0].id });

      await expect(
        noUser.documents.create({ data: { title: "anonymous", authorId: getData().users[0].id } })
      ).rejects.toBeInstanceOf(PolicyViolationError);
    });
  });

  describe("pagination and counting", () => {
    const byTitle = { title: "asc" } as const;

    it("paginate returns only the workspace's rows, and counts only them", async () => {
      const page = await acme().documents.paginate({ orderBy: byTitle, count: true });

      expect(page.items.map((d) => d.title)).toEqual(["Acme onboarding", "Acme roadmap"]);
      expect(page.totalCount).toBe(2);
    });

    it("a cursor from another workspace's row is only a position, never a way across", async () => {
      const everything = await internal().documents.paginate({ orderBy: byTitle });
      const globex = everything.items.find((d) => d.title === "Globex roadmap");

      const before = await acme().documents.paginate({
        orderBy: byTitle,
        before: globex?.$$meta.cursor,
        count: true,
      });

      expect(before.items.map((d) => d.title)).toEqual(["Acme onboarding", "Acme roadmap"]);
      expect(before.totalCount).toBe(2);
    });
  });

  describe("writes", () => {
    it("create fills the workspace from the setting, ignoring a value spread into the data", async () => {
      const data = getData();

      const created = await acme().documents.create({
        data: {
          title: "Acme spec",
          authorId: data.users[0].id,
          ...{ workspaceId: data.workspaces[1].id },
        },
        return: true,
      });

      expect(created?.workspaceId).toBe(data.workspaces[0].id);
    });

    it("create refuses a row its insert check rejects, and writes nothing", async () => {
      const data = getData();

      const error = await acme()
        .documents.create({ data: { title: "Ghostwritten", authorId: data.users[1].id } })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PolicyViolationError);
      expect(error).toMatchObject({
        table: "documents",
        command: "insert",
        as: "permissive",
        policies: ["members_insert"],
      });
      await expect(internal().documents.count({ where: { title: "Ghostwritten" } })).resolves.toBe(
        0
      );
    });

    it("update cannot touch another workspace's row", async () => {
      const updated = await acme().documents.update({
        where: { id: foreignDocument()?.id ?? "" },
        set: { title: "hijacked" },
        return: true,
      });

      expect(updated).toBeNull();
      const row = await internal().documents.findOne({
        where: { id: foreignDocument()?.id ?? "" },
      });
      expect(row?.title).toBe("Globex roadmap");
    });

    it("update skips a row its author did not write, silently, as USING does", async () => {
      const data = getData();
      const theirs = data.documents.find((d) => d.title === "Acme onboarding");

      const updated = await acme().documents.update({
        where: { id: theirs?.id ?? "" },
        set: { title: "taken over" },
        return: true,
      });

      expect(updated).toBeNull();
    });

    it("update refuses a change its check rejects, and changes nothing", async () => {
      const data = getData();
      const own = data.documents.find((d) => d.title === "Acme roadmap");

      // Handing the row to someone else: visible before, fails `author_writes` after.
      await expect(
        acme().documents.update({
          where: { id: own?.id ?? "" },
          set: { authorId: data.users[1].id },
        })
      ).rejects.toMatchObject({ name: "PolicyViolationError", policies: ["author_writes"] });

      const row = await internal().documents.findOne({ where: { id: own?.id ?? "" } });
      expect(row?.authorId).toBe(data.users[0].id);
    });

    it("updateMany changes only the visible rows and returns them", async () => {
      const updated = await acme().documents.updateMany({
        where: { title: { endsWith: "roadmap" } },
        set: { body: "Revised" },
        return: { title: true },
      });

      expect(updated.map((d) => d.title)).toEqual(["Acme roadmap"]);
      const globex = await internal().documents.findOne({
        where: { id: foreignDocument()?.id ?? "" },
      });
      expect(globex?.body).not.toBe("Revised");
    });

    it("refuses every update on a table no update policy covers, even one matching nothing", async () => {
      // No permissive policy: the WHERE is false, so nothing matches — and the check's constant
      // arm must not be folded into an error at plan time.
      const [own] = getData().drafts;

      await expect(
        acme().drafts.update({ where: { id: own?.id ?? "" }, set: { title: "edited" } })
      ).resolves.toBeNull();

      const row = await internal().drafts.findOne({ where: { id: own?.id ?? "" } });
      expect(row?.title).toBe("Acme draft");
    });

    it("delete removes only a visible row the author wrote", async () => {
      const data = getData();
      const own = data.documents.find((d) => d.title === "Acme roadmap");
      const theirs = data.documents.find((d) => d.title === "Acme onboarding");

      await acme().documents.delete({ where: { id: foreignDocument()?.id ?? "" } });
      await acme().documents.delete({ where: { id: theirs?.id ?? "" } });
      await acme().documents.delete({ where: { id: own?.id ?? "" } });

      const left = await internal().documents.findMany({ select: { title: true } });
      expect(left.map((d) => d.title).sort()).toEqual(["Acme onboarding", "Globex roadmap"]);
    });
  });

  describe("bypass and raw SQL", () => {
    it("a bypass client reads across every workspace", async () => {
      await expect(internal().documents.count()).resolves.toBe(3);
    });

    it("moves a row between workspaces only through raw SQL on a client without settings", async () => {
      const data = getData();
      const own = data.documents.find((d) => d.title === "Acme roadmap");

      await getClient().$execute(
        sql`UPDATE "documents" SET "workspace_id" = ${data.workspaces[1].id}
            WHERE "id" = ${own?.id ?? ""}`.toQuery()
      );

      expect(await acme().documents.findMany({})).toHaveLength(1);
    });
  });

  describe("transactions", () => {
    it("carries the settings into a transaction", async () => {
      const titles = await acme().$transaction(async (tx) => {
        const documents = await tx.documents.findMany({ select: { title: true } });
        return documents.map((d) => d.title).sort();
      });

      expect(titles).toEqual(["Acme onboarding", "Acme roadmap"]);
    });

    it("rolls the whole transaction back when a check fails, without retrying it", async () => {
      const data = getData();
      let attempts = 0;

      await expect(
        acme().$transaction(async (tx) => {
          attempts += 1;
          await tx.documents.create({ data: { title: "First", authorId: data.users[0].id } });
          await tx.documents.create({ data: { title: "Second", authorId: data.users[1].id } });
        })
      ).rejects.toBeInstanceOf(PolicyViolationError);

      expect(attempts).toBe(1);
      await expect(internal().documents.count({ where: { title: "First" } })).resolves.toBe(0);
    });
  });
});
