import { describe, expectTypeOf, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import type { SharedFieldsOf } from "@dsqlbase/core/definition";
import { createClient } from "../create.js";
import {
  datetime,
  hasMany,
  hasOne,
  relations,
  table,
  text,
  union,
  uuid,
} from "../../schema/index.js";

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const photos = table("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  photoUrl: text("photo_url").notNull(),
}).meta({ __typename: "Photo" as const });

const videos = table("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("owner_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  videoUrl: text("video_url").notNull(),
  caption: text("caption"),
});

const posts = union({ photos, videos });

const userRelations = relations(users, {
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
  latest: hasOne(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
});

const photoRelations = relations(photos, {
  owner: hasOne(users, { from: [photos.columns.userId], to: [users.columns.id] }),
});

const schema = { users, photos, videos, posts, userRelations, photoRelations };

const session = { execute: vi.fn(async () => []) } as unknown as Session;
const dsql = createClient({ schema, session });

const where = { id: { eq: "u1" } };

describe("union types", () => {
  it("shares the fields every member declares with one value type", () => {
    expectTypeOf<SharedFieldsOf<{ photos: typeof photos; videos: typeof videos }>>().toEqualTypeOf<
      "id" | "userId" | "createdAt"
    >();
  });

  it("types a has-many to a union as an array of member rows tagged by $$key", async () => {
    const user = await dsql.users.findOne({ where, join: { feed: true } });
    const post = user?.feed[0];

    expectTypeOf(post?.$$key).toEqualTypeOf<"photos" | "videos" | undefined>();

    if (post?.$$key === "photos") {
      expectTypeOf(post.photoUrl).toEqualTypeOf<string>();
      expectTypeOf(post.$$meta.__typename).toEqualTypeOf<"Photo">();
      expectTypeOf(post).not.toHaveProperty("videoUrl");
    }

    if (post?.$$key === "videos") {
      expectTypeOf(post.caption).toEqualTypeOf<string | null>();
      expectTypeOf(post.$$meta.key).toEqualTypeOf<"videos">();
    }
  });

  it("types a has-one to a union as a member row or null", async () => {
    const user = await dsql.users.findOne({ where, join: { latest: true } });

    expectTypeOf(user?.latest).toEqualTypeOf<NonNullable<typeof user>["latest"] | undefined>();
    expectTypeOf<NonNullable<typeof user>["latest"]>().toExtend<{ $$key: string } | null>();
  });

  it("narrows a shared select, merged with each member's own", async () => {
    const user = await dsql.users.findOne({
      where,
      join: {
        feed: { select: { id: true }, on: { photos: { select: { photoUrl: true } } } },
      },
    });
    const post = user?.feed[0];

    if (post?.$$key === "photos") {
      expectTypeOf(post.id).toEqualTypeOf<string>();
      expectTypeOf(post.photoUrl).toEqualTypeOf<string>();
      expectTypeOf(post).not.toHaveProperty("createdAt");
    }

    if (post?.$$key === "videos") {
      expectTypeOf(post.id).toEqualTypeOf<string>();
      expectTypeOf(post).not.toHaveProperty("videoUrl");
    }
  });

  it("removes a member excluded with false from the result", async () => {
    const user = await dsql.users.findOne({ where, join: { feed: { on: { videos: false } } } });

    expectTypeOf(user?.feed[0]?.$$key).toEqualTypeOf<"photos" | undefined>();
  });

  it("types a member join from on.<alias>.join", async () => {
    const user = await dsql.users.findOne({
      where,
      join: { feed: { on: { photos: { join: { owner: true } } } } },
    });
    const post = user?.feed[0];

    if (post?.$$key === "photos") {
      expectTypeOf(post.owner?.name).toEqualTypeOf<string | undefined>();
    }
  });

  // Type-checked only: the invalid calls would also throw at runtime.
  it("accepts only shared fields at the shared level and member aliases in on", () => {
    const check = () => {
      dsql.users.findOne({
        where,
        join: {
          feed: {
            // @ts-expect-error `photoUrl` belongs to one member only
            select: { photoUrl: true },
          },
        },
      });

      dsql.users.findOne({
        where,
        join: {
          feed: {
            // @ts-expect-error `videoUrl` is not shared, so it cannot filter across the union
            where: { videoUrl: "x" },
          },
        },
      });

      dsql.users.findOne({
        where,
        join: {
          feed: {
            // @ts-expect-error `clips` is not a member
            on: { clips: true },
          },
        },
      });

      dsql.users.findOne({
        where,
        join: {
          feed: {
            orderBy: { createdAt: "desc" },
            where: { createdAt: { gt: new Date() } },
            on: { videos: { where: { caption: { exists: true } } } },
          },
        },
      });
    };

    expectTypeOf(check).toBeFunction();
  });

  it("types $$key in where and orderBy as the member aliases", () => {
    const check = (types: ("photos" | "videos")[]) => {
      dsql.users.findOne({
        where,
        join: {
          feed: {
            where: { or: [{ $$key: { in: types } }, { $$key: "photos" }] },
            orderBy: { $$key: "asc", createdAt: "desc" },
          },
        },
      });

      dsql.users.findOne({
        where,
        join: {
          feed: {
            // @ts-expect-error `clips` is not a member alias
            where: { $$key: "clips" },
          },
        },
      });

      dsql.users.findOne({
        where,
        join: {
          feed: {
            // @ts-expect-error `$$key` accepts eq, neq and in only
            where: { $$key: { gt: "photos" } },
          },
        },
      });
    };

    expectTypeOf(check).toBeFunction();
  });

  it("leaves members a runtime $$key filter rules out in the result type", async () => {
    const user = await dsql.users.findOne({
      where,
      join: { feed: { where: { $$key: "photos" } } },
    });

    expectTypeOf(user?.feed[0]?.$$key).toEqualTypeOf<"photos" | "videos" | undefined>();
  });
});
