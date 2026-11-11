import {
  belongsTo,
  datetime,
  hasMany,
  relations,
  table,
  text,
  union,
  uuid,
} from "../src/schema/index.js";

export const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const posts = table("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").notNull(),
  mediaId: uuid("media_id"),
  title: text("title").notNull(),
  content: text("content").notNull(),
});

export const comments = table("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id").notNull(),
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
});

export const photos = table("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  photoUrl: text("photo_url").notNull(),
});

export const videos = table("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  videoUrl: text("video_url").notNull(),
});

export const media = union(
  { photos, videos },
  {
    id: uuid("id"),
    userId: uuid("user_id").notNull(),
    createdAt: datetime("created_at").notNull(),
  }
);

export const userRelations = relations(users, {
  posts: hasMany(posts, { from: [users.columns.id], to: [posts.columns.authorId] }),
  feed: hasMany(media, { from: [users.columns.id], to: [media.columns.userId] }),
});

export const postRelations = relations(posts, {
  author: belongsTo(users, { from: [posts.columns.authorId], to: [users.columns.id] }),
  comments: hasMany(comments, { from: [posts.columns.id], to: [comments.columns.postId] }),
  media: belongsTo(media, { from: [posts.columns.mediaId], to: [media.columns.id] }),
});

export const commentRelations = relations(comments, {
  author: belongsTo(users, { from: [comments.columns.authorId], to: [users.columns.id] }),
});

export const mediaRelations = relations(media, {
  owner: belongsTo(users, {
    from: [media.columns.userId],
    to: [users.columns.id],
  }),
});
