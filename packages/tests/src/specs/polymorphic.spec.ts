import { describe, expect, it } from "vitest";
import { sql, TenancyError } from "@dsqlbase/core";
import { encodeGlobalId, GlobalIdError } from "dsqlbase";
import { withSeededClient } from "../fixures/seeded-client";
import { SeededData } from "../fixures/seed";

/**
 * Polymorphic relations, end to end against PGlite.
 *
 * Every expected order is computed here from the seeded rows, by the rule the library documents:
 * `orderBy`, then `$$key`, then the primary key. It is never read back from another query, so a
 * wrong order cannot agree with itself.
 */
describe("polymorphic relations", () => {
  const { getClient, getData } = withSeededClient();

  const wrap = (key: string, id: string) => encodeGlobalId(key, { id });

  type Post = SeededData["photos"][number] & { key: "photos" | "videos" };

  /** Every post by an author, tagged with its member alias, as the seed wrote them. */
  const postsBy = (authorId: string): Post[] => [
    ...getData()
      .photos.filter((post) => post.authorId === authorId)
      .map((post) => ({ ...post, key: "photos" as const })),
    ...getData()
      .videos.filter((post) => post.authorId === authorId)
      .map((post) => ({ ...post, key: "videos" as const })),
  ];

  /** `createdAt` in `direction`, then `$$key` and the key in `tiebreak`. */
  const ordered = (posts: Post[], direction: 1 | -1, tiebreak: 1 | -1 = 1) =>
    [...posts].sort(
      (a, b) =>
        direction * a.createdAt.localeCompare(b.createdAt) ||
        tiebreak * a.key.localeCompare(b.key) ||
        tiebreak * a.id.localeCompare(b.id)
    );

  const ids = (posts: { key: string; id: string }[]) =>
    posts.map((post) => wrap(post.key, post.id));

  describe("a has-many to a union", () => {
    it("returns every member's rows, ordered across members with $$key and the key breaking ties", async () => {
      const author = getData().authors[0];

      const result = await getClient().authors.findOne({
        where: { id: { eq: author.id } },
        join: { posts: { orderBy: { createdAt: "desc" } } },
      });

      expect(result?.posts.map((post) => post.id)).toEqual(ids(ordered(postsBy(author.id), -1)));
    });

    it("tags each row with $$key and its member's own $$meta", async () => {
      const author = getData().authors[0];

      const result = await getClient().authors.findOne({
        where: { id: { eq: author.id } },
        join: { posts: true },
      });

      for (const post of result?.posts ?? []) {
        expect(post.$$meta.key).toBe(post.$$key);
        expect(post.$$meta.__typename).toBe(post.$$key === "photos" ? "Photo" : "Video");
      }

      const photo = result?.posts.find((post) => post.$$key === "photos");
      expect(photo?.$$key === "photos" && photo.photoUrl).toBeTruthy();
    });

    it("limits and offsets across members", async () => {
      const author = getData().authors[0];

      const result = await getClient().authors.findOne({
        where: { id: { eq: author.id } },
        join: { posts: { orderBy: { createdAt: "desc" }, limit: 2, offset: 1 } },
      });

      expect(result?.posts.map((post) => post.id)).toEqual(
        ids(ordered(postsBy(author.id), -1).slice(1, 3))
      );
    });

    it("applies on per member: a member-only select, and false to leave a member out", async () => {
      const author = getData().authors[0];

      const result = await getClient().authors.findOne({
        where: { id: { eq: author.id } },
        join: {
          posts: {
            select: { id: true },
            on: { photos: { select: { photoUrl: true } }, videos: false },
          },
        },
      });

      expect(result?.posts).toHaveLength(
        postsBy(author.id).filter((p) => p.key === "photos").length
      );
      expect(result?.posts.every((post) => post.$$key === "photos" && post.photoUrl)).toBe(true);
      expect(result?.posts[0]).not.toHaveProperty("caption");
    });

    it("walks a member's own relations through on.<alias>.join", async () => {
      const author = getData().authors[0];

      const result = await getClient().authors.findOne({
        where: { id: { eq: author.id } },
        join: { posts: { on: { photos: { join: { author: true } } } } },
      });

      const photo = result?.posts.find((post) => post.$$key === "photos");
      expect(photo?.$$key === "photos" ? photo.author?.name : undefined).toBe(author.name);
    });

    it("filters by member from a runtime $$key value", async () => {
      const author = getData().authors[0];
      const types: ("photos" | "videos")[] = ["videos"];

      const result = await getClient().authors.findOne({
        where: { id: { eq: author.id } },
        join: { posts: { where: { $$key: { in: types } } } },
      });

      expect(result?.posts.map((post) => post.$$key)).toEqual(
        postsBy(author.id)
          .filter((post) => post.key === "videos")
          .map(() => "videos")
      );
    });

    it("filters and orders on a nullable shared field", async () => {
      const author = getData().authors[0];

      const result = await getClient().authors.findOne({
        where: { id: { eq: author.id } },
        join: { posts: { where: { caption: { exists: true } }, orderBy: { caption: "asc" } } },
      });

      expect(result?.posts.map((post) => post.caption)).toEqual(["Clip", "Sunrise", "Tie"]);
    });
  });

  describe("a has-one to a union", () => {
    it("returns the first row across members, or null", async () => {
      const [first, second] = getData().authors;

      const result = await getClient().authors.findMany({
        where: { id: { in: [first.id, second.id] } },
        join: { latestPost: { orderBy: { createdAt: "desc" } } },
      });

      const latest = (authorId: string) => ids(ordered(postsBy(authorId), -1).slice(0, 1))[0];
      const byId = new Map(result.map((author) => [author.id, author.latestPost?.id]));

      expect(byId.get(wrap("authors", first.id))).toBe(latest(first.id));
      expect(byId.get(wrap("authors", second.id))).toBe(latest(second.id));
    });
  });

  describe("a union with a member that is the table joined from", () => {
    it("reads folders and files inside a folder, and a nested folder's own entries", async () => {
      const [root, child] = getData().folders;

      const result = await getClient().folders.findOne({
        where: { id: { eq: root.id } },
        join: {
          entries: {
            orderBy: { name: "asc" },
            on: { folders: { join: { entries: { orderBy: { name: "asc" } } } } },
          },
        },
      });

      expect(result?.entries.map((entry) => `${entry.$$key}:${entry.name}`)).toEqual([
        "files:a.txt",
        "files:b.txt",
        "folders:child",
      ]);

      const nested = result?.entries.find((entry) => entry.$$key === "folders");
      expect(nested?.id).toBe(wrap("folders", child.id));
      expect(
        nested?.$$key === "folders" ? nested.entries.map((entry) => entry.name) : undefined
      ).toEqual(["c.txt"]);
    });
  });

  describe("a belongs-to a union", () => {
    it("joins the member the discriminator names, so subjectId === subject.id", async () => {
      const comments = await getClient().postComments.findMany({
        join: { subject: true },
        orderBy: { body: "asc" },
      });

      const photoComment = comments.find((comment) => comment.body === "Lovely light");
      const videoComment = comments.find((comment) => comment.body === "Great clip");

      expect(photoComment?.subject?.$$key).toBe("photos");
      expect(videoComment?.subject?.$$key).toBe("videos");

      for (const comment of comments) {
        expect(comment.subjectId).toBe(comment.subject?.id);
      }

      expect(photoComment?.subjectId).toBe(wrap("photos", getData().photos[0].id));
    });

    it("joins the right member when two members hold the same key", async () => {
      const photo = getData().photos[0];
      const author = getData().authors[0];

      // A video under the photo's own uuid, and a comment on it.
      await getClient().$query(sql`
        INSERT INTO "videos" ("id", "owner_id", "created_at", "video_url")
        VALUES (${photo.id}, ${author.id}, '2026-02-01T00:00:00Z', 'twin.mp4')
      `);
      await getClient().$query(sql`
        INSERT INTO "post_comments" ("subject_type", "subject_id", "body")
        VALUES ('videos', ${photo.id}, 'On the twin')
      `);

      const comments = await getClient().postComments.findMany({
        where: { subjectId: { in: [wrap("photos", photo.id), wrap("videos", photo.id)] } },
        join: { subject: true },
      });

      const bySubject = Object.fromEntries(
        comments.map((comment) => [comment.body, comment.subject?.$$key])
      );

      expect(bySubject).toEqual({ "Lovely light": "photos", "On the twin": "videos" });
    });

    it("fills the discriminator from a global id on create", async () => {
      const video = getData().videos[1];

      await getClient().postComments.create({
        data: { subjectId: wrap("videos", video.id), body: "Filled" },
      });

      const [row] = await getClient().$query<{ subject_type: string; subject_id: string }>(
        sql`SELECT "subject_type", "subject_id" FROM "post_comments" WHERE "body" = 'Filled'`
      );

      expect(row).toEqual({ subject_type: "videos", subject_id: video.id });
    });

    it("refuses a global id that contradicts the discriminator", () => {
      expect(() =>
        getClient().postComments.create({
          data: {
            subjectId: wrap("videos", getData().videos[0].id),
            subjectType: "photos",
            body: "Wrong",
          },
        })
      ).toThrow(GlobalIdError);
    });

    it("filters by a global id on the discriminator and the key together", async () => {
      const photo = getData().photos[0];

      const matched = await getClient().postComments.findMany({
        where: { subjectId: { eq: wrap("photos", photo.id) } },
      });
      // The right uuid under the wrong member matches nothing.
      const missed = await getClient().postComments.findMany({
        where: { subjectId: { eq: wrap("videos", photo.id) } },
      });

      expect(matched.map((comment) => comment.body)).toEqual(["Lovely light"]);
      expect(missed).toEqual([]);
    });
  });

  describe("the union client", () => {
    it("reads a union at the top level, filtered, ordered and limited", async () => {
      const author = getData().authors[0];

      const result = await getClient().posts.findMany({
        where: { authorId: { eq: author.id } },
        orderBy: { createdAt: "asc" },
        limit: 3,
      });

      expect(result.map((post) => post.id)).toEqual(
        ids(ordered(postsBy(author.id), 1).slice(0, 3))
      );
    });

    it("counts across members", async () => {
      const author = getData().authors[0];

      expect(await getClient().posts.count({ where: { authorId: { eq: author.id } } })).toBe(
        postsBy(author.id).length
      );
      expect(await getClient().posts.count({ where: { $$key: "videos" } })).toBe(
        getData().videos.length
      );
    });

    it("pages forward and back under a total order, with ties across members", async () => {
      const all = [...postsBy(getData().authors[0].id), ...postsBy(getData().authors[1].id)];
      // The appended keys follow the last key's direction, as on a table.
      const expected = ids(ordered(all, -1, -1));

      const forward: string[] = [];
      let page = await getClient().posts.paginate({
        orderBy: { createdAt: "desc" },
        limit: 2,
      });

      const counted = await getClient().posts.paginate({ limit: 1, count: true });
      expect(counted.totalCount).toBe(all.length);

      forward.push(...page.items.map((item) => item.id));

      while (page.hasNextPage) {
        page = await getClient().posts.paginate({
          orderBy: { createdAt: "desc" },
          limit: 2,
          after: page.endCursor,
        });
        forward.push(...page.items.map((item) => item.id));
      }

      expect(forward).toEqual(expected);

      const backward: string[] = [...page.items.map((item) => item.id)];

      while (page.hasPreviousPage) {
        page = await getClient().posts.paginate({
          orderBy: { createdAt: "desc" },
          limit: 2,
          before: page.startCursor,
        });
        backward.unshift(...page.items.map((item) => item.id));
      }

      expect(backward).toEqual(expected);
    });
  });

  describe("global-id lookups with a widened on map", () => {
    it("forwards where and join per node", async () => {
      const author = getData().authors[0];

      const found = await getClient().$findByGlobalId({
        id: wrap("authors", author.id),
        on: { authors: { join: { posts: { where: { $$key: "photos" } } } } },
      });
      const missed = await getClient().$findByGlobalId({
        id: wrap("authors", author.id),
        on: { authors: { where: { name: { eq: "Someone else" } } } },
      });

      expect(
        found?.$$key === "authors" && found.posts.every((post) => post.$$key === "photos")
      ).toBe(true);
      expect(missed).toBeNull();
    });
  });

  describe("tenancy", () => {
    const acme = () => getClient().$identityClaims({ workspaceId: getData().workspaces[0].id });

    it("filters the tenant-scoped member of a union join, and not the global one", async () => {
      const data = getData();
      const user = data.users[0];

      const result = await acme().users.findOne({
        where: { id: { eq: user.id } },
        join: { feed: true },
      });

      const documents = result?.feed.filter((item) => item.$$key === "documents") ?? [];
      const bookmarks = result?.feed.filter((item) => item.$$key === "bookmarks") ?? [];

      expect(documents.map((item) => item.title)).toEqual(["Acme roadmap"]);
      expect(bookmarks.map((item) => item.title)).toEqual(["Read later"]);
    });

    it("filters the scoped member on the union client, its count and its pages", async () => {
      const data = getData();
      const acmeDocuments = data.documents.filter((d) => d.workspaceId === data.workspaces[0].id);
      const expected = acmeDocuments.length + data.bookmarks.length;

      const rows = await acme().userFeed.findMany({});
      const count = await acme().userFeed.count();
      const page = await acme().userFeed.paginate({ limit: 100 });

      expect(
        rows
          .filter((row) => row.$$key === "documents")
          .map((row) => row.title)
          .sort()
      ).toEqual(acmeDocuments.map((d) => d.title).sort());
      expect(rows).toHaveLength(expected);
      expect(count).toBe(expected);
      expect(page.items).toHaveLength(expected);
    });

    it("refuses a union with a scoped member on an enforcing client with no claims", () => {
      const client = getClient() as unknown as {
        users: { findMany: (args: object) => unknown };
      };

      expect(() => client.users.findMany({ join: { feed: true } })).toThrow(TenancyError);
    });
  });
});
