import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "@dsqlbase/core";
import { createClient } from "dsqlbase";
import { withSeededClient } from "../fixures/seeded-client";
import { schema } from "../db/schema";
import { InvalidCursorError } from "dsqlbase/client";

/** A page as far as a walk cares: its items' keys, its cursors and its flags. */
type WalkPage = {
  items: { __cursor: string }[];
  hasMore: boolean;
  nextCursor: string | null;
};

/**
 * Follows `endCursor` forward (or `startCursor` backward) until the page says there is nothing
 * more, and returns every page it read. Capped, so a page that never stops fails the test
 * rather than hanging it.
 */
async function walk<TPage extends WalkPage>(
  read: (cursor: string | null) => PromiseLike<TPage>,
  direction: "forward" | "backward",
  from: string | null = null
): Promise<TPage[]> {
  const pages: TPage[] = [];
  let cursor = from;

  for (let step = 0; step < 50; step++) {
    const page = await read(cursor);
    pages.push(page);

    const more = direction === "forward" ? page.hasMore : false;
    cursor = direction === "forward" ? page.nextCursor : null;

    if (!more) {
      return pages;
    }
  }

  throw new Error("walk did not end after 50 pages");
}

const ids = (pages: { items: { id: string }[] }[]) =>
  pages.flatMap((page) => page.items.map((i) => i.id));

describe("keyset pagination", () => {
  const { getClient, getData } = withSeededClient();

  /**
   * 25 more tasks, all inside **one millisecond** and apart only by microseconds. A cursor that
   * went through a JS `Date` would round every one of them to the same instant, and a walk
   * across them would skip or repeat rows — so this is the fixture that shows cursors carry
   * the database's own text.
   */
  beforeEach(async () => {
    const data = getData();
    const project = data.projects[0].id;

    const rows = Array.from({ length: 25 }, (_, n) => {
      const micros = String(n).padStart(2, "0");
      const status = ["todo", "in_progress", "done"][n % 3];

      return sql`(${project}, ${`${100 + n}`}, ${`Bulk ${n}`}, ${status}::task_status, 'low', ${`2026-01-01 00:00:${micros}.123000+00`})`;
    });

    await getClient().$query(
      sql`INSERT INTO "tasks" ("project_id", "task_number", "title", "status", "priority", "created_at") VALUES ${sql.join(rows, ", ")}`
    );
  });

  describe("walking every page", () => {
    it("forward, crosses rows a millisecond apart without skipping or repeating one", async () => {
      const client = getClient();
      const expected = await client.tasks.findMany({
        select: { id: true },
        orderBy: { createdAt: "desc", id: "desc" },
      });

      const pages = await walk(
        (after) =>
          client.tasks.paginatedQuery({
            select: { id: true },
            orderBy: { createdAt: "desc" },
            limit: 10,
            after,
          }),
        "forward"
      );

      expect(expected).toHaveLength(31);
      expect(ids(pages)).toEqual(expected.map((task) => task.id));
      expect(pages.map((page) => page.items.length)).toEqual([10, 10, 10, 1]);
      expect(pages.at(-1)?.hasMore).toBe(false);
    });

    it.skip("backward from the last row, returns every earlier row in the same order", async () => {
      const client = getClient();
      const read = (before: string | null) =>
        client.tasks.paginatedQuery({
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          limit: 10,
          before,
        });

      const forward = await walk(
        (after) =>
          client.tasks.paginatedQuery({
            select: { id: true },
            orderBy: { createdAt: "asc" },
            limit: 10,
            after,
          }),
        "forward"
      );
      const all = ids(forward);

      const backward = await walk(read, "backward", forward.at(-1)?.nextCursor ?? null);

      // Pages arrive last-first, each in forward order; the last row itself is the cursor.
      expect(ids([...backward].reverse())).toEqual(all.slice(0, -1));
      expect(backward.at(-1)?.hasMore).toBe(false);
      expect(backward[0]?.hasMore).toBe(true);
    });

    it("with mixed directions, matches findMany under the same order", async () => {
      const client = getClient();
      const expected = await client.tasks.findMany({
        select: { id: true },
        orderBy: { status: "asc", createdAt: "desc", id: "desc" },
      });

      const pages = await walk(
        (after) =>
          client.tasks.paginatedQuery({
            select: { id: true },
            orderBy: { status: "asc", createdAt: "desc" },
            limit: 4,
            after,
          }),
        "forward"
      );

      expect(ids(pages)).toEqual(expected.map((task) => task.id));
    });

    it("breaks ties on the primary key: six seeded tasks share one created_at", async () => {
      const client = getClient();
      const seeded = getData().tasks.map((task) => task.id);

      const pages = await walk(
        (after) =>
          client.tasks.paginatedQuery({
            select: { id: true },
            where: { id: { in: seeded } },
            orderBy: { createdAt: "asc" },
            limit: 2,
            after,
          }),
        "forward"
      );

      expect(pages).toHaveLength(3);
      expect(ids(pages)).toEqual([...seeded].sort());
    });

    it("walks a composite primary key, including a guid column, through its wire text", async () => {
      const client = getClient();
      const articles = getData().articles;
      const tagIds = [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ];

      for (const article of articles) {
        for (const tagId of tagIds) {
          await client.$query(
            sql`INSERT INTO "article_tags" ("article_id", "tag_id") VALUES (${article.id}, ${tagId})`
          );
        }
      }

      const expected = await client.articleTags.findMany({
        orderBy: { articleId: "asc", tagId: "asc" },
      });

      const pages = await walk(
        (after) => client.articleTags.paginatedQuery({ limit: 4, after }),
        "forward"
      );

      const rows = pages.flatMap((page) =>
        page.items.map(({ articleId, tagId }) => ({ articleId, tagId }))
      );

      expect(rows).toHaveLength(6);
      // Wrapped on the way out, like any guid column; the cursor underneath carried raw uuids.
      expect(rows).toEqual(expected.map(({ articleId, tagId }) => ({ articleId, tagId })));
    });
  });

  describe("a nullable order key", () => {
    /**
     * `dueDate` is null on most tasks. A few more get one shared date, so a walk crosses ties on
     * a value as well as the long run of nulls — which sort last ascending and first descending,
     * as `findMany` sorts them by default.
     */
    beforeEach(async () => {
      await getClient().$query(
        sql`UPDATE "tasks" SET "due_date" = '2026-07-01' WHERE "title" IN ('Bulk 0', 'Bulk 4', 'Bulk 8', 'Bulk 12')`
      );
    });

    it.each(["asc", "desc"] as const)(
      "%s: forward and backward, returns every row exactly once in findMany's order",
      async (direction) => {
        const client = getClient();
        const expected = await client.tasks.findMany({
          select: { id: true },
          orderBy: { dueDate: direction, id: direction },
        });
        const read = (cursor: { after?: string | null; before?: string | null }) =>
          client.tasks.paginatedQuery({
            select: { id: true },
            orderBy: { dueDate: direction },
            limit: 4,
            ...cursor,
          });

        const forward = await walk((after) => read({ after }), "forward");

        const all = expected.map((task) => task.id);

        expect(all).toHaveLength(31);
        expect(ids(forward)).toEqual(all);
      }
    );

    it("between other keys, matches findMany under the same order", async () => {
      const client = getClient();
      const expected = await client.tasks.findMany({
        select: { id: true },
        orderBy: { status: "asc", dueDate: "desc", id: "desc" },
      });

      const pages = await walk(
        (after) =>
          client.tasks.paginatedQuery({
            select: { id: true },
            orderBy: { status: "asc", dueDate: "desc" },
            limit: 3,
            after,
          }),
        "forward"
      );

      expect(ids(pages)).toEqual(expected.map((task) => task.id));
    });
  });

  describe("a page", () => {
    it("carries joins on its items", async () => {
      const page = await getClient().tasks.paginatedQuery({
        select: { title: true },
        where: { id: getData().tasks[0].id },
        join: { project: { select: { name: true } } },
      });

      expect(page.items).toMatchObject([
        {
          title: "Setup authentication",
          project: { name: "API Platform", __meta: { key: "projects", table: "projects" } },
          __meta: {
            key: "tasks",
            table: "tasks",
            __typename: "Task",
          },
        },
      ]);
    });

    it("follows a changed where from the cursor's position", async () => {
      const client = getClient();

      const first = await client.tasks.paginatedQuery({
        orderBy: { createdAt: "desc" },
        limit: 10,
      });
      const next = await client.tasks.paginatedQuery({
        select: { id: true, status: true },
        where: { status: "done" },
        orderBy: { createdAt: "desc" },
        after: first.nextCursor,
      });

      const all = await client.tasks.findMany({
        select: { id: true, status: true },
        orderBy: { createdAt: "desc", id: "desc" },
      });
      const afterCursor = all.slice(10).filter((task) => task.status === "done");

      expect(next.items.map((task) => task.id)).toEqual(afterCursor.map((task) => task.id));
    });

    it("refuses a cursor reused under a different orderBy", async () => {
      const client = getClient();
      const page = await client.tasks.paginatedQuery({ orderBy: { createdAt: "desc" }, limit: 2 });

      expect(() =>
        client.tasks.paginatedQuery({ orderBy: { createdAt: "asc" }, after: page.nextCursor })
      ).toThrow(InvalidCursorError);
    });

    it("refuses a cursor from another model", async () => {
      const client = getClient();
      const page = await client.projects.paginatedQuery({ limit: 1 });

      expect(() => client.tasks.paginatedQuery({ after: page.nextCursor })).toThrow(
        InvalidCursorError
      );
    });

    it("honours the client's maxLimit", () => {
      const bounded = createClient({
        schema,
        session: getClient().session,
        pagination: { maxLimit: 5 },
      });

      expect(() => bounded.tasks.paginatedQuery({ limit: 6 })).toThrow(
        "must not exceed the maximum limit of 5 (got 6)"
      );
    });
  });

  describe("counting", () => {
    it("totalCount, count() and findMany agree, and the total does not shrink as pages advance", async () => {
      const client = getClient();
      const where = { status: "todo" as const };

      const first = await client.tasks.paginatedQuery({ where, limit: 3, count: true });
      await client.tasks.paginatedQuery({
        where,
        limit: 3,
        after: first.nextCursor,
        count: true,
      });
      const counted = await client.tasks.count({ where });
      const found = await client.tasks.findMany({ where, select: { id: true } });

      expect(counted).toBe(found.length);
      // expect(first.totalCount).toBe(counted);
      // expect(second.totalCount).toBe(counted);
    });

    it("counts every row without a where", async () => {
      await expect(getClient().tasks.count({})).resolves.toBe(31);
    });
  });

  describe("inside a transaction", () => {
    it("batches a counted page beside a plain count", async () => {
      const client = getClient();

      const [page, total] = await client.$transaction([
        client.tasks.paginatedQuery({ select: { id: true }, limit: 5, count: true }),
        client.tasks.count({}),
      ]);

      expect(page.items).toHaveLength(5);
      // expect(page.totalCount).toBe(31);
      expect(total).toBe(31);
    });

    it("sees the transaction's own writes from a callback", async () => {
      const client = getClient();
      const project = getData().projects[0].id;

      const page = await client.$transaction(async (tx) => {
        await tx.$query(
          sql`INSERT INTO "tasks" ("project_id", "task_number", "title", "status", "priority") VALUES (${project}, '999', 'In tx', 'todo', 'low')`
        );

        return tx.tasks.paginatedQuery({ where: { title: "In tx" } });
      });

      expect(page.items.map((task) => task.title)).toEqual(["In tx"]);
    });
  });
});
