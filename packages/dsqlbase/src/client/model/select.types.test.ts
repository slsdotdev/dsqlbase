import { describe, expectTypeOf, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import {
  belongsTo,
  datetime,
  hasMany,
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

const posts = table("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
});

const comments = table("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id").notNull(),
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
});

const tasks = table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id"),
  title: text("title").notNull(),
});

const photos = table("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  photoUrl: text("photo_url").notNull(),
});

const videos = table("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("owner_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  videoUrl: text("video_url").notNull(),
});

const media = union({ photos, videos });

const userRelations = relations(users, {
  posts: hasMany(posts, { from: [users.columns.id], to: [posts.columns.authorId] }),
  feed: hasMany(media, { from: [users.columns.id], to: [media.columns.userId] }),
});

const postRelations = relations(posts, {
  author: belongsTo(users, { from: [posts.columns.authorId], to: [users.columns.id] }),
  comments: hasMany(comments, { from: [posts.columns.id], to: [comments.columns.postId] }),
});

const commentRelations = relations(comments, {
  author: belongsTo(users, { from: [comments.columns.authorId], to: [users.columns.id] }),
});

const taskRelations = relations(tasks, {
  parent: belongsTo(tasks, { from: [tasks.columns.parentId], to: [tasks.columns.id] }),
  children: hasMany(tasks, { from: [tasks.columns.id], to: [tasks.columns.parentId] }),
});

const schema = {
  users,
  posts,
  comments,
  tasks,
  photos,
  videos,
  media,
  userRelations,
  postRelations,
  commentRelations,
  taskRelations,
};

const session = { execute: vi.fn(async () => []) } as unknown as Session;
const dsql = createClient({ schema, session });

const where = { id: { eq: "p1" } };

type Meta<K extends string> = { key: K; table: string; schema?: string };

describe("which columns a select returns", () => {
  it("returns every column with no select", () => {
    expectTypeOf(dsql.posts.findOne({ where }).$typeOf).toEqualTypeOf<{
      id: string;
      authorId: string;
      title: string;
      subtitle: string | null;
      $$meta: Meta<"posts">;
    } | null>();
  });

  it("returns every column when select names nothing, as the runtime does", () => {
    const none = dsql.posts.findOne({ where }).$typeOf;

    expectTypeOf(dsql.posts.findOne({ where, select: {} }).$typeOf).toEqualTypeOf(none);
    expectTypeOf(
      dsql.posts.findOne({ where, select: { id: false, title: false } }).$typeOf
    ).toEqualTypeOf(none);
  });

  it("returns only the relations when select names only relations", () => {
    expectTypeOf(dsql.posts.findOne({ where, select: { author: true } }).$typeOf).toEqualTypeOf<{
      $$meta: Meta<"posts">;
      author: { id: string; name: string; $$meta: Meta<"users"> } | null;
    } | null>();
  });

  it("returns every column on a write's return that names nothing", () => {
    expectTypeOf(
      dsql.posts.create({ data: { authorId: "u", title: "t" }, return: {} }).$typeOf
    ).toEqualTypeOf<{
      id: string;
      authorId: string;
      title: string;
      subtitle: string | null;
      $$meta: Meta<"posts">;
    } | null>();
  });
});

describe("a relation in select", () => {
  it("is typed as the join form", () => {
    const selected = dsql.posts.findMany({
      select: { title: true, author: { name: true }, comments: true },
    }).$typeOf;
    const joined = dsql.posts.findMany({
      select: { title: true },
      join: { author: { select: { name: true } }, comments: true },
    }).$typeOf;

    expectTypeOf(selected).toEqualTypeOf(joined);
  });

  it("nests a relation inside a relation's field map", () => {
    const query = dsql.posts.findMany({
      select: { comments: { body: true, author: { name: true } } },
    });

    expectTypeOf(query.$typeOf).items.toHaveProperty("comments").toEqualTypeOf<
      {
        body: string;
        $$meta: Meta<"comments">;
        author: { name: string; $$meta: Meta<"users"> } | null;
      }[]
    >();
  });

  it("follows a self-referential relation", async () => {
    const task = await dsql.tasks.findOne({
      where: { id: { eq: "t1" } },
      select: { title: true, parent: { title: true, parent: { id: true } }, children: true },
    });

    expectTypeOf(task?.parent?.parent?.id).toEqualTypeOf<string | undefined>();
    expectTypeOf(task?.children[0]?.parentId).toEqualTypeOf<string | null | undefined>();
  });

  it("takes a union's shared fields", async () => {
    const user = await dsql.users.findOne({
      where: { id: { eq: "u1" } },
      select: { feed: { id: true, createdAt: true } },
    });
    const post = user?.feed[0];

    expectTypeOf(post?.$$key).toEqualTypeOf<"photos" | "videos" | undefined>();
    expectTypeOf(post?.createdAt).toEqualTypeOf<Date | undefined>();
    expectTypeOf(user).not.toHaveProperty("name");
  });

  it("carries through a page's items", async () => {
    const page = await dsql.posts.paginate({ select: { title: true, author: { name: true } } });

    expectTypeOf(page.items).items.toHaveProperty("author").toEqualTypeOf<{
      name: string;
      $$meta: Meta<"users">;
    } | null>();
  });

  // Type-checked only: the invalid calls would also throw at runtime.
  it("refuses what belongs in join, and what is not a field", () => {
    const check = () => {
      dsql.posts.findMany({
        select: { author: true },
        // @ts-expect-error `author` is already in select
        join: { author: true },
      });

      dsql.users.findMany({
        // @ts-expect-error query args are written in join, not in select
        select: { posts: { where: { title: "x" } } },
      });

      dsql.users.findMany({
        // @ts-expect-error `photoUrl` is not shared by every member of the union
        select: { feed: { photoUrl: true } },
      });

      dsql.posts.findMany({
        // @ts-expect-error `editor` is neither a column nor a relation of posts
        select: { editor: true },
      });

      dsql.posts.create({
        data: { authorId: "u", title: "t" },
        // @ts-expect-error a write's return has no relations
        return: { author: true },
      });

      // A falsy join entry beside the selected relation is not an overlap.
      dsql.posts.findMany({ select: { author: true }, join: { author: false } });
    };

    expectTypeOf(check).toBeFunction();
  });
});
