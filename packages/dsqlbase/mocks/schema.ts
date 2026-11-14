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
  description: text("description"),
  content: text("content").notNull(),
  createdAt: datetime("created_at").notNull(),
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

export const teams = table("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const teamMembers = table("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
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
  teamMemberships: hasMany(teamMembers, {
    from: [users.columns.id],
    to: [teamMembers.columns.userId],
  }),
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

export const videoRelations = relations(videos, {
  posts: hasMany(posts, {
    from: [videos.columns.id],
    to: [posts.columns.mediaId],
  }),
});

export const teamRelations = relations(teams, {
  members: hasMany(teamMembers, {
    from: [teams.columns.id],
    to: [teamMembers.columns.teamId],
  }),
});

export const teamMemberRelations = relations(teamMembers, {
  team: belongsTo(teams, {
    from: [teamMembers.columns.teamId],
    to: [teams.columns.id],
  }),
  user: belongsTo(users, {
    from: [teamMembers.columns.userId],
    to: [users.columns.id],
  }),
});
