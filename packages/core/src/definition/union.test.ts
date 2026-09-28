import { describe, expect, expectTypeOf, it } from "vitest";
import { Kind, Relation } from "./base.js";
import { ColumnDefinition, ColumnConfig } from "./column.js";
import { RelationsDefinition } from "./relations.js";
import { TableDefinition } from "./table.js";
import { SharedFieldsOf, UnionColumnDefinition, UnionDefinition } from "./union.js";

const uuid = (name: string) =>
  new ColumnDefinition<string, ColumnConfig<string, string>>(name, { dataType: "uuid" });
const text = (name: string) =>
  new ColumnDefinition<string, ColumnConfig<string, string>>(name, { dataType: "text" });
const int = (name: string) =>
  new ColumnDefinition<string, ColumnConfig<number, number>>(name, { dataType: "integer" });

const photos = new TableDefinition("photos", {
  columns: {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id"),
    url: text("photo_url"),
    size: int("size"),
  },
});

const videos = new TableDefinition("videos", {
  columns: {
    id: uuid("id").primaryKey(),
    userId: uuid("owner_id"),
    url: text("video_url"),
    size: text("size"),
    duration: int("duration"),
  },
});

const users = new TableDefinition("users", {
  columns: { id: uuid("id").primaryKey() },
});

describe("UnionDefinition", () => {
  it("is a UNION node that names its members", () => {
    const posts = new UnionDefinition({ photos, videos });

    expect(posts.kind).toBe(Kind.UNION);
    expect(posts.name).toBe("union(photos|videos)");
    expect(posts.members.photos).toBe(photos);
  });

  it("shares the fields every member declares with the same data type", () => {
    const posts = new UnionDefinition({ photos, videos });

    // `size` is integer on one member and text on the other; `duration` is on one member only.
    expect(Object.keys(posts.columns)).toEqual(["id", "userId", "url"]);
  });

  it("resolves a shared field to each member's own column", () => {
    const posts = new UnionDefinition({ photos, videos });
    const userId = posts.columns.userId;

    expect(userId).toBeInstanceOf(UnionColumnDefinition);
    expect(userId.kind).toBe(Kind.UNION_COLUMN);
    expect(userId.name).toBe("userId");
    expect(userId.members.photos).toBe(photos.columns.userId);
    expect(userId.members.videos).toBe(videos.columns.userId);
  });

  it("types the shared fields as the intersection with equal value types", () => {
    expectTypeOf<SharedFieldsOf<{ photos: typeof photos; videos: typeof videos }>>().toEqualTypeOf<
      "id" | "userId" | "url"
    >();
  });

  it("rejects a union without members", () => {
    expect(() => new UnionDefinition({})).toThrow(/at least one member/);
  });

  it("rejects a union as a member", () => {
    const posts = new UnionDefinition({ photos, videos });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new UnionDefinition({ posts } as any)).toThrow(/cannot contain another union/);
  });

  it("serializes its members by table name, and produces no DDL", () => {
    const posts = new UnionDefinition({ photos, videos });

    expect(posts.toJSON()).toEqual({
      kind: Kind.UNION,
      name: "union(photos|videos)",
      members: { photos: "photos", videos: "videos" },
    });
  });
});

describe("RelationsDefinition to a union", () => {
  it("serializes the union target, the per-member columns and the discriminator", () => {
    const posts = new UnionDefinition({ photos, videos });
    const comments = new TableDefinition("comments", {
      columns: {
        id: uuid("id").primaryKey(),
        subjectType: text("subject_type"),
        subjectId: uuid("subject_id"),
      },
    });

    const json = new RelationsDefinition(comments, {
      subject: {
        type: Relation.BELONGS_TO,
        target: posts,
        from: [comments.columns.subjectId],
        to: [posts.columns.id],
        discriminator: comments.columns.subjectType,
      },
    }).toJSON();

    expect(json.relations.subject).toEqual({
      type: "belongs_to",
      target: posts.toJSON(),
      from: [{ kind: Kind.COLUMN, name: "subject_id" }],
      to: [{ kind: Kind.UNION_COLUMN, name: "id" }],
      discriminator: { kind: Kind.COLUMN, name: "subject_type" },
    });
  });

  it("serializes a per-member to map", () => {
    const posts = new UnionDefinition({ photos, videos });

    const json = new RelationsDefinition(users, {
      feed: {
        type: Relation.HAS_MANY,
        target: posts,
        from: [users.columns.id],
        to: { photos: [photos.columns.userId], videos: [videos.columns.userId] },
      },
    }).toJSON();

    expect(json.relations.feed.to).toEqual({
      photos: [{ kind: Kind.COLUMN, name: "user_id" }],
      videos: [{ kind: Kind.COLUMN, name: "owner_id" }],
    });
  });
});
