import { describe, expectTypeOf, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import {
  belongsTo,
  datetime,
  hasMany,
  hasOne,
  relations,
  table,
  tenantScope,
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
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  videoUrl: text("video_url").notNull(),
  caption: text("caption"),
});

const posts = union(
  { photos, videos },
  {
    id: uuid("id"),
    userId: uuid("user_id").notNull(),
    createdAt: datetime("created_at").notNull(),
  }
);

const userRelations = relations(users, {
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
  latest: hasOne(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
});

const photoRelations = relations(photos, {
  owner: hasOne(users, { from: [photos.columns.userId], to: [users.columns.id] }),
});

const reactions = table("reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id").notNull(),
  emoji: text("emoji").notNull(),
});

// Declared on the union: every member has `reactions`.
const postRelations = relations(posts, {
  reactions: hasMany(reactions, { from: [posts.columns.id], to: [reactions.columns.postId] }),
});

// A belongs-to a union without a discriminator.
const reactionRelations = relations(reactions, {
  post: belongsTo(posts, { from: [reactions.columns.postId], to: [posts.columns.id] }),
});

const schema = {
  users,
  photos,
  videos,
  posts,
  reactions,
  userRelations,
  photoRelations,
  postRelations,
  reactionRelations,
};

const session = { execute: vi.fn(async () => []) } as unknown as Session;
const dsql = createClient({ schema, session });

describe("the union client", () => {
  it("reads a union as its members' rows, narrowed by $$key", async () => {
    const rows = await dsql.posts.findMany({
      where: { $$key: "videos" },
      orderBy: { createdAt: "desc" },
    });
    const [row] = rows;

    if (row?.$$key === "videos") {
      expectTypeOf(row.videoUrl).toEqualTypeOf<string>();
    }

    const one = await dsql.posts.findOne({ where: { id: { eq: "x" } }, on: { videos: false } });

    expectTypeOf(one?.$$key).toEqualTypeOf<"photos" | undefined>();
  });

  it("types a page's items with a cursor on each member's meta", async () => {
    const page = await dsql.posts.paginate({ orderBy: { createdAt: "desc" }, count: true });
    const [item] = page.items;

    expectTypeOf(page.totalCount).toEqualTypeOf<number>();
    expectTypeOf(item?.$$meta.cursor).toEqualTypeOf<string>();

    if (item?.$$key === "photos") {
      expectTypeOf(item.$$meta.__typename).toEqualTypeOf<"Photo">();
    }
  });

  it("joins a relation declared on the union from every member", async () => {
    const [joined] = await dsql.posts.findMany({
      join: { reactions: { select: { emoji: true } } },
    });
    const [selected] = await dsql.posts.findMany({ select: { id: true, reactions: true } });

    type Joined = NonNullable<typeof joined>["reactions"][number];
    type Selected = NonNullable<typeof selected>["reactions"][number];

    expectTypeOf(joined).not.toBeNever();
    expectTypeOf(selected).not.toBeNever();
    expectTypeOf<Joined["emoji"]>().toEqualTypeOf<string>();
    expectTypeOf<Selected["postId"]>().toEqualTypeOf<string>();
  });

  it("gives each member the union's relations", async () => {
    const photo = await dsql.photos.findOne({
      where: { id: { eq: "x" } },
      select: { reactions: true },
    });

    expectTypeOf(photo?.reactions[0]?.emoji).toEqualTypeOf<string | undefined>();
  });

  it("joins a belongs-to a union that declares no discriminator", async () => {
    const [reaction] = await dsql.reactions.findMany({ join: { post: true } });

    expectTypeOf(reaction?.post?.$$key).toEqualTypeOf<"photos" | "videos" | undefined>();
  });

  it("counts to a number", async () => {
    expectTypeOf(await dsql.posts.count()).toEqualTypeOf<number>();
  });

  it("shows a union only when every member is visible", () => {
    const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });
    const notes = ws.table("notes", { id: uuid("id").primaryKey(), title: text("title") });
    const links = table("links", { id: uuid("id").primaryKey(), title: text("title") });
    const items = union({ notes, links }, { id: uuid("id"), title: text("title") });
    const onlyLinks = union({ links }, { id: uuid("id") });

    const base = createClient({ schema: { notes, links, items, onlyLinks }, session });

    expectTypeOf(base).not.toHaveProperty("items");
    expectTypeOf(base).toHaveProperty("onlyLinks");
    expectTypeOf(base.$identityClaims({ workspaceId: "w1" })).toHaveProperty("items");

    const loose = createClient({
      schema: { notes, links, items },
      session,
      tenancy: { enforce: false },
    });

    expectTypeOf(loose).toHaveProperty("items");
  });
});
