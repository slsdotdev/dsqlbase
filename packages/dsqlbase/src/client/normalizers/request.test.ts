import { describe, expect, it } from "vitest";
import { context } from "../../../mocks/context.js";
import { RequestNormalizer } from "./request.js";
import { sql, UnionSelectOperationArgs } from "@dsqlbase/core";

const normalizer = new RequestNormalizer(context);

describe("RequestNormalizer", () => {
  describe("select", () => {
    it("creates table select request", () => {
      const table = context.schema.getTable("users");
      const request = normalizer.createSelectRequest(
        table,
        {
          select: { id: true, name: true },
          where: { id: "1" },
          join: {
            feed: true,
          },
        },
        "one"
      );

      expect(request.args.select).toStrictEqual([
        ["id", table.getColumn("id")],
        ["name", table.getColumn("name")],
      ]);
      expect(request.args.where).toBeDefined();
      expect(request.args.join?.length).toBe(1);
      expect(request.args.join?.[0][0]).toBe("feed");
    });

    it("creates request with relation in selection", () => {
      const table = context.schema.getTable("posts");
      const inSelection = normalizer.createSelectRequest(
        table,
        { select: { id: true, author: true } },
        "many"
      );

      const inJoin = normalizer.createSelectRequest(
        table,
        {
          select: { id: true },
          join: { author: true },
        },
        "many"
      );

      expect(inSelection).toStrictEqual(inJoin);
    });

    it("creates request with relation fields in selection", () => {
      const table = context.schema.getTable("posts");
      const inSelection = normalizer.createSelectRequest(
        table,
        { select: { id: true, author: { name: true } } },
        "many"
      );

      const inJoin = normalizer.createSelectRequest(
        table,
        {
          select: { id: true },
          join: { author: { select: { name: true } } },
        },
        "many"
      );

      expect(inSelection).toStrictEqual(inJoin);
    });

    it("creates request with nested relation fields in selection", () => {
      const table = context.schema.getTable("posts");
      const inSelection = normalizer.createSelectRequest(
        table,
        {
          select: {
            title: true,
            comments: { body: true, author: { name: true } },
          },
        },
        "many"
      );

      const inJoin = normalizer.createSelectRequest(
        table,
        {
          select: { title: true },
          join: {
            comments: {
              select: { body: true },
              join: {
                author: { select: { name: true } },
              },
            },
          },
        },
        "many"
      );

      expect(inSelection).toStrictEqual(inJoin);
    });

    it("keeps join's query args alongside a relation in select", () => {
      const table = context.schema.getTable("users");

      const inSelection = normalizer.createSelectRequest(
        table,
        {
          select: { name: true, posts: { title: true } },
          join: { feed: { orderBy: { createdAt: "desc" }, limit: 5 } },
        },
        "many"
      );

      const inJoin = normalizer.createSelectRequest(
        table,
        {
          select: { name: true },
          join: {
            posts: { select: { title: true } },
            feed: { orderBy: { createdAt: "desc" }, limit: 5 },
          },
        },
        "many"
      );

      expect(inSelection).toStrictEqual(inJoin);
    });

    it("ignores a selected relation set to false", () => {
      const table = context.schema.getTable("posts");

      const isSelection = normalizer.createSelectRequest(
        table,
        {
          select: { id: true, author: false },
        },
        "many"
      );

      const inJoin = normalizer.createSelectRequest(
        table,
        {
          select: { id: true },
          join: { author: false },
        },
        "many"
      );

      expect(isSelection.args.join).toBe(undefined);
      expect(isSelection).toStrictEqual(inJoin);
    });

    it("refuses the same field in select and join", () => {
      const table = context.schema.getTable("posts");

      expect(() => {
        normalizer.createSelectRequest(
          table,
          {
            select: { author: true },
            join: { author: { select: { name: true } } },
          },
          "many"
        );
      }).toThrow('Relation "author" appears in both select and join on "posts"');
    });

    it("refuses query args in a relation's field map: they belong in join", () => {
      const table = context.schema.getTable("users");

      expect(() => {
        normalizer.createSelectRequest(
          table,
          // @ts-expect-error `where` is not a field of posts
          { select: { posts: { where: { title: "x" } } } },
          "many"
        );
      }).toThrow('Invalid field "where" in selection for table "posts"');
    });

    it("refuses a field that is neither a column nor a relation", () => {
      const table = context.schema.getTable("posts");
      expect(() => {
        normalizer.createSelectRequest(
          table,
          {
            // @ts-expect-error `editor` is not a field of posts
            select: { editor: true },
          },
          "many"
        );
      }).toThrow('Invalid field "editor" in selection for table "posts"');
    });

    describe("unions", () => {
      it("selects all members by default", () => {
        const union = context.schema.getUnion("media");

        const request = normalizer.createUnionSelectRequest(
          union,
          { select: { id: true, createdAt: true } },
          "many"
        );

        expect(request).toBeDefined();
        expect(request.args.members.length).toBe(union.memberAliases.length);

        for (const [, member] of request.args.members) {
          expect(member.select?.map(([field]) => field)).toEqual(["id", "createdAt"]);
        }
      });

      it("respects the `on` argument to include only specified members", () => {
        const union = context.schema.getUnion("media");

        const request = normalizer.createUnionSelectRequest(
          union,
          { select: { id: true }, on: { photos: true, videos: false } },
          "many"
        );

        expect(request).toBeDefined();
        expect(request.args.members.length).toBe(1);
        expect(request.args.members[0][0]).toBe("photos");
      });

      it("merges base args with member-specific ones", () => {
        const union = context.schema.getUnion("media");

        const request = normalizer.createUnionSelectRequest(
          union,
          {
            select: { id: true },
            where: { createdAt: new Date("2023-01-01") },
            on: {
              photos: { where: { createdAt: new Date("2023-02-01"), userId: { neq: "1" } } },
              videos: { select: { videoUrl: true } },
            },
          },
          "many"
        );

        const { photos, videos } = Object.fromEntries(request.args.members);
        const photosWhere = sql`${photos.where}`.toQuery();
        const videosWhere = sql`${videos.where}`.toQuery();

        expect(photosWhere.text).toEqual(
          '("photos"."created_at" = $1 AND "photos"."created_at" = $2 AND "photos"."user_id" <> $3)'
        );
        expect(photosWhere.params).toEqual([
          new Date("2023-01-01").toISOString(),
          new Date("2023-02-01").toISOString(),
          "1",
        ]);
        expect(photos.select?.map(([field]) => field)).toEqual(["id"]);

        expect(videosWhere.text).toEqual('"videos"."created_at" = $1');
        expect(videosWhere.params).toEqual([new Date("2023-01-01").toISOString()]);
        expect(videos.select?.map(([field]) => field)).toEqual(["id", "videoUrl"]);
      });

      it("creates request on union relation", () => {
        const table = context.schema.getTable("users");

        const request = normalizer.createSelectRequest(
          table,
          {
            select: {
              id: true,
              feed: { id: true },
            },
          },
          "many"
        );

        const feed = request.args.join?.[0][1] as UnionSelectOperationArgs;
        expect(feed).toBeDefined();
        expect(feed.members?.map(([field]) => field)).toEqual(["photos", "videos"]);
      });

      it("throws an error when selecting a non-existent union member", () => {
        const union = context.schema.getUnion("media");

        expect(() =>
          normalizer.createUnionSelectRequest(
            union,
            {
              select: { id: true },
              // @ts-expect-error non-existent union member
              on: { nonExistentMember: true },
            },
            "many"
          )
        ).toThrow(
          '"nonExistentMember" in `on` is not a member of union "media" (members: photos, videos).'
        );
      });
    });
  });

  describe("mutations", () => {
    it("creates an insert request", () => {
      const table = context.schema.getTable("users");

      const request = normalizer.createInsertRequest(
        table,
        {
          data: {
            id: "1",
            name: "John Doe",
          },
        },
        "one"
      );

      expect(request).toBeDefined();
      expect(request.args.data[0].length).toEqual(2);
    });

    it("creates an update request", () => {
      const table = context.schema.getTable("users");

      const request = normalizer.createUpdateRequest(
        table,
        {
          set: { name: "Jane Doe" },
          where: { id: "1" },
        },
        "one"
      );

      expect(request).toBeDefined();
      expect(request.args.set.length).toEqual(1);
    });
  });
});
