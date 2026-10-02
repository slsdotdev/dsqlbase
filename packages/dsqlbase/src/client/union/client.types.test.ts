import { describe, expectTypeOf, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import {
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

  it("counts to a number", async () => {
    expectTypeOf(await dsql.posts.count()).toEqualTypeOf<number>();
  });

  it("shows a union only when every member is visible", () => {
    const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });
    const notes = ws.table("notes", { id: uuid("id").primaryKey(), title: text("title") });
    const links = table("links", { id: uuid("id").primaryKey(), title: text("title") });
    const items = union({ notes, links });
    const onlyLinks = union({ links });

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
