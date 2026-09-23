import { describe, expect, it } from "vitest";
import { sql, TenancyError } from "@dsqlbase/core";
import { createClient } from "dsqlbase";
import { withSeededClient } from "../fixures/seeded-client";
import { schema } from "../db/schema";

/**
 * Cross-tenant isolation, end to end against PGlite.
 *
 * Both workspaces are seeded through raw SQL, so the other tenant's rows are genuinely there
 * and a leak would show as data rather than as a missing table. Every assertion is about what a
 * scoped client can reach, never about what it was asked for.
 *
 * `paginate`, `count` and ad-hoc joins do not exist yet; extending these specs to them is an
 * exit criterion on the pagination and runtime-joins work, not an oversight here.
 */
describe("tenant isolation", () => {
  const { getClient, getData } = withSeededClient();

  /** A client scoped to the first seeded workspace. */
  const acme = () => getClient().$identityClaims({ workspaceId: getData().workspaces[0].id });

  /** A second client over the same database that does not enforce, for the unscoped checks. */
  const internal = () =>
    createClient({
      schema,
      session: getClient().session,
      tenancy: { enforce: false },
    });

  describe("reads", () => {
    it("findMany returns only the scoped workspace's rows", async () => {
      const data = getData();

      const documents = await acme().documents.findMany({});

      expect(documents).toHaveLength(2);
      expect(documents.map((d) => d.workspaceId)).toEqual([
        data.workspaces[0].id,
        data.workspaces[0].id,
      ]);
      expect(documents.map((d) => d.title).sort()).toEqual(["Acme onboarding", "Acme roadmap"]);
    });

    it("findOne cannot reach another workspace's row by its primary key", async () => {
      const data = getData();
      const foreign = data.documents.find((d) => d.workspaceId === data.workspaces[1].id);

      const result = await acme().documents.findOne({ where: { id: foreign?.id ?? "" } });

      expect(result).toBeNull();
    });

    it("a where on the claim column cannot widen the scope", async () => {
      const data = getData();

      // Becomes `workspace_id = acme AND workspace_id = globex`: an empty result, never the
      // other tenant's rows.
      const documents = await acme().documents.findMany({
        where: { workspaceId: data.workspaces[1].id },
      });

      expect(documents).toEqual([]);
    });

    it("scopes a joined level reached from a global table", async () => {
      const data = getData();

      const workspaces = await acme().workspaces.findMany({
        select: { id: true, name: true },
        join: { documents: { select: { id: true, title: true } } },
      });

      const globex = workspaces.find((w) => w.id === data.workspaces[1].id);

      // The global parent is visible — it is not tenant-scoped — but its documents are not.
      expect(globex).toBeDefined();
      expect(globex?.documents).toEqual([]);
    });

    it("scopes a join that correlates on something other than the claim column", async () => {
      const data = getData();

      // `users` is global and the correlation is on author_id, so nothing but the tenant
      // predicate keeps the other workspace's document out of this result. The joins above
      // correlate on the claim column itself, where the correlation would have done the job
      // anyway.
      const authors = await acme().users.findMany({
        where: { id: data.users[0].id },
        select: { id: true },
        join: { authoredDocuments: { select: { title: true } } },
      });

      expect(authors[0]?.authoredDocuments.map((d) => d.title)).toEqual(["Acme roadmap"]);
    });

    it("scopes the second nested level as well as the first", async () => {
      const data = getData();

      const workspaces = await acme().workspaces.findMany({
        select: { id: true },
        join: {
          documents: {
            select: { id: true },
            join: { comments: { select: { id: true, author: true } } },
          },
        },
      });

      const acmeWorkspace = workspaces.find((w) => w.id === data.workspaces[0].id);
      const authors = acmeWorkspace?.documents.flatMap((d) => d.comments.map((c) => c.author));

      expect(authors?.sort()).toEqual(["alice", "alice", "bob"]);
      // "carol" only ever commented in the other workspace.
      expect(authors).not.toContain("carol");
    });

    it("scopes a belongs-to back to a global parent", async () => {
      const data = getData();

      const documents = await acme().documents.findMany({
        select: { id: true },
        join: { workspace: { select: { name: true } } },
      });

      expect(documents).toHaveLength(2);
      expect(documents.every((d) => d.workspace?.name === data.workspaces[0].name)).toBe(true);
    });
  });

  describe("writes", () => {
    it("create fills the claim from the identity", async () => {
      const data = getData();

      const created = await acme().documents.create({
        data: { title: "Acme spec" },
        return: true,
      });

      expect(created?.workspaceId).toBe(data.workspaces[0].id);
    });

    it("create ignores a claim value spread into the data", async () => {
      const data = getData();

      const created = await acme().documents.create({
        data: { title: "Acme notes", ...{ workspaceId: data.workspaces[1].id } },
        return: true,
      });

      // The claim wins over the input, so an untyped spread cannot plant a row elsewhere.
      expect(created?.workspaceId).toBe(data.workspaces[0].id);
    });

    it("update cannot touch another workspace's row", async () => {
      const data = getData();
      const foreign = data.documents.find((d) => d.workspaceId === data.workspaces[1].id);

      const updated = await acme().documents.update({
        where: { id: foreign?.id ?? "" },
        set: { title: "hijacked" },
        return: true,
      });

      expect(updated).toBeNull();

      const [row] = await internal().documents.findMany({ where: { id: foreign?.id ?? "" } });
      expect(row?.title).toBe("Globex roadmap");
    });

    it("delete cannot remove another workspace's row", async () => {
      const data = getData();
      const foreign = data.documents.find((d) => d.workspaceId === data.workspaces[1].id);

      await acme().documents.delete({ where: { id: foreign?.id ?? "" } });

      const survivors = await internal().documents.findMany({
        where: { workspaceId: data.workspaces[1].id },
      });

      expect(survivors).toHaveLength(1);
    });

    it("delete removes the scoped workspace's own row", async () => {
      const data = getData();
      const own = data.documents.find((d) => d.workspaceId === data.workspaces[0].id);

      await acme().documents.delete({ where: { id: own?.id ?? "" } });

      expect(await acme().documents.findMany({})).toHaveLength(1);
    });
  });

  describe("enforcement", () => {
    it("refuses a tenant table on a client with no claims", () => {
      expect(() => getClient().documents.findMany({})).toThrow(TenancyError);
    });

    it("refuses a tenant table reached through a join, which the types cannot see", () => {
      expect(() => getClient().workspaces.findMany({ join: { documents: true } })).toThrow(
        /Table "documents" is tenant-scoped/
      );
    });

    it("reads across every workspace when enforcement is off", async () => {
      const documents = await internal().documents.findMany({});

      expect(documents).toHaveLength(3);
    });

    it("still refuses an insert with no claims when enforcement is off", () => {
      expect(() => internal().documents.create({ data: { title: "orphan" } })).toThrow(
        /without claim "workspaceId"/
      );
    });

    it("moves a row between workspaces only through raw SQL on an unscoped client", async () => {
      const data = getData();
      const own = data.documents.find((d) => d.workspaceId === data.workspaces[0].id);

      await internal().$execute(
        sql`UPDATE "documents" SET "workspace_id" = ${data.workspaces[1].id}
            WHERE "id" = ${own?.id ?? ""}`.toQuery()
      );

      expect(await acme().documents.findMany({})).toHaveLength(1);
    });
  });

  describe("transactions", () => {
    it("carries the scope into a transaction", async () => {
      const data = getData();

      const titles = await acme().$transaction(async (tx) => {
        const documents = await tx.documents.findMany({ select: { title: true } });
        return documents.map((d) => d.title).sort();
      });

      expect(titles).toEqual(["Acme onboarding", "Acme roadmap"]);
      expect(data.documents).toHaveLength(3);
    });

    it("writes inside a scoped transaction land in the scoped workspace", async () => {
      const data = getData();

      await acme().$transaction(async (tx) => {
        await tx.documents.create({ data: { title: "From a transaction" } });
      });

      const created = await acme().documents.findMany({ where: { title: "From a transaction" } });

      expect(created).toHaveLength(1);
      expect(created[0]?.workspaceId).toBe(data.workspaces[0].id);
    });
  });
});
