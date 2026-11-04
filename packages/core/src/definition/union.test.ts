import { describe, expect, expectTypeOf, it } from "vitest";
import { Kind, Relation } from "./base.js";
import { ColumnDefinition, ColumnConfig } from "./column.js";
import { RelationsDefinition } from "./relations.js";
import { TableDefinition } from "./table.js";
import { CommonFieldsOf, UnionColumnDefinition, UnionDefinition } from "./union.js";

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

/** A column kind of its own — what a `guid()` is to a `uuid()`. */
class TaggedColumn extends ColumnDefinition<string, ColumnConfig<string, string>> {}

describe("UnionDefinition", () => {
  const union = () => new UnionDefinition({ photos, videos }, { id: uuid("id") });

  it("is a UNION node that names its members", () => {
    const posts = union();

    expect(posts.kind).toBe(Kind.UNION);
    expect(posts.name).toBe("union(photos|videos)");
    expect(posts.members.photos).toBe(photos);
  });

  it("shares exactly the fields it declares", () => {
    // `url` is on every member too, but undeclared fields are not shared.
    expect(Object.keys(union().columns)).toEqual(["id"]);
  });

  it("resolves a declared field to each member's own column", () => {
    const id = union().columns.id;

    expect(id).toBeInstanceOf(UnionColumnDefinition);
    expect(id.kind).toBe(Kind.UNION_COLUMN);
    expect(id.name).toBe("id");
    expect(id.members.photos).toBe(photos.columns.id);
    expect(id.members.videos).toBe(videos.columns.id);
  });

  it("types its columns from the declaration, and only fields every member has", () => {
    expectTypeOf<keyof ReturnType<typeof union>["columns"]>().toEqualTypeOf<"id">();
    expectTypeOf<CommonFieldsOf<{ photos: typeof photos; videos: typeof videos }>>().toEqualTypeOf<
      "id" | "userId" | "url" | "size"
    >();
  });

  it("rejects a field a member does not have", () => {
    expect(() => new UnionDefinition({ photos, videos }, { duration: int("duration") })).toThrow(
      /declares "duration", but member "photos" has no such field/
    );
  });

  it("rejects a field a member stores under another column name", () => {
    expect(() => new UnionDefinition({ photos, videos }, { userId: uuid("user_id") })).toThrow(
      /member "videos" stores it in column "owner_id", not "user_id"/
    );
  });

  it("rejects a field whose data type differs on a member", () => {
    const a = new TableDefinition("a", { columns: { size: int("size") } });
    const b = new TableDefinition("b", { columns: { size: text("size") } });

    expect(() => new UnionDefinition({ a, b }, { size: int("size") })).toThrow(
      /member "b" declares it as a different kind of column \(text\)/
    );
  });

  it("rejects a field whose column kind differs on a member", () => {
    const a = new TableDefinition("a", {
      columns: { id: new TaggedColumn("id", { dataType: "uuid" }) },
    });
    const b = new TableDefinition("b", { columns: { id: uuid("id") } });

    expect(
      () => new UnionDefinition({ a, b }, { id: new TaggedColumn("id", { dataType: "uuid" }) })
    ).toThrow(/member "b" declares it as a different kind of column/);
  });

  it("rejects a NOT NULL field a member allows NULL in", () => {
    const a = new TableDefinition("a", { columns: { url: text("url").notNull() } });
    const b = new TableDefinition("b", { columns: { url: text("url") } });

    expect(() => new UnionDefinition({ a, b }, { url: text("url").notNull() })).toThrow(
      /member "b" allows NULL in it, and the union declares it NOT NULL/
    );
    expect(() => new UnionDefinition({ a, b }, { url: text("url") })).not.toThrow();
  });

  it("rejects a union without members", () => {
    expect(() => new UnionDefinition({}, {})).toThrow(/at least one member/);
  });

  it("rejects a union as a member", () => {
    const posts = union();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new UnionDefinition({ posts } as any, {})).toThrow(/cannot contain another union/);
  });

  it("serializes its members by table name, and produces no DDL", () => {
    expect(union().toJSON()).toEqual({
      kind: Kind.UNION,
      name: "union(photos|videos)",
      members: { photos: "photos", videos: "videos" },
    });
  });
});

describe("RelationsDefinition to a union", () => {
  it("serializes the union target, the per-member columns and the discriminator", () => {
    const posts = new UnionDefinition({ photos, videos }, { id: uuid("id") });
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
    const posts = new UnionDefinition({ photos, videos }, { id: uuid("id") });

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
