import { describe, expect, expectTypeOf, it } from "vitest";
import { UnionDefinition } from "@dsqlbase/core/definition";
import { table } from "./table.js";
import { uuid } from "./columns/uuid.js";
import { text } from "./columns/text.js";
import { belongsTo, hasMany, hasOne, relations } from "./relations.js";
import { union } from "./union.js";

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  friendId: uuid("friend_id"),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
});

describe("relations definition", () => {
  it("should create a relations definition with the correct name and relations", () => {
    const userRelations = relations(users, {
      friends: hasMany(users, { from: [users.columns.id], to: [users.columns.friendId] }),
      bestFriend: belongsTo(users, { from: [users.columns.friendId], to: [users.columns.id] }),
    });

    expect(userRelations.name).toBe("users_relations");
  });
});

describe("relations to a union", () => {
  const photos = table("photos", {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id"),
    photoUrl: text("photo_url"),
  });

  const videos = table("videos", {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id"),
    userId: uuid("user_id"),
  });

  const posts = union({ photos, videos });

  const comments = table("comments", {
    id: uuid("id").primaryKey(),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
  });

  it("builds a union whose columns are the shared fields", () => {
    expect(posts).toBeInstanceOf(UnionDefinition);
    expect(Object.keys(posts.columns)).toEqual(["id", "userId"]);
  });

  it("takes shared fields or one list per member as to", () => {
    const rels = relations(users, {
      feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
      owned: hasMany(posts, {
        from: [users.columns.id],
        to: { photos: [photos.columns.userId], videos: [videos.columns.ownerId] },
      }),
      latest: hasOne(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
    });

    expect(rels.relations.feed.target).toBe(posts);
    expect(rels.relations.owned.to).toEqual({
      photos: [photos.columns.userId],
      videos: [videos.columns.ownerId],
    });
  });

  it("carries the discriminator on a belongs-to a union", () => {
    const rels = relations(comments, {
      subject: belongsTo(posts, {
        from: [comments.columns.subjectId],
        to: [posts.columns.id],
        discriminator: comments.columns.subjectType,
      }),
    });

    expect(rels.relations.subject.discriminator).toBe(comments.columns.subjectType);
  });

  it("types the discriminator as required on a union and absent on a table", () => {
    relations(comments, {
      // @ts-expect-error a belongs-to a union must name its discriminator
      subject: belongsTo(posts, { from: [comments.columns.subjectId], to: [posts.columns.id] }),
    });

    relations(comments, {
      author: belongsTo(users, {
        from: [comments.columns.subjectId],
        to: [users.columns.id],
        // @ts-expect-error a belongs-to a table has nothing to discriminate
        discriminator: comments.columns.subjectType,
      }),
    });

    // @ts-expect-error `photoUrl` is on one member only, so it is not a shared field
    expectTypeOf(posts.columns).toHaveProperty("photoUrl");
  });
});
