import { describe, expect, it } from "vitest";
import { TableDefinition } from "./table.js";
import { ColumnDefinition } from "./column.js";
import { RelationsDefinition } from "./relations.js";
import { Relation } from "./base.js";

const users = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").notNull().unique(),
    profilePicture: new ColumnDefinition("profile_picture_url"),
  },
});

const posts = new TableDefinition("posts", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    authorId: new ColumnDefinition("author_id").notNull(),
    publicationId: new ColumnDefinition("publication_id").notNull(),
    title: new ColumnDefinition("title").notNull(),
    slug: new ColumnDefinition("slug").notNull().unique(),
    summary: new ColumnDefinition("summary"),
    content: new ColumnDefinition("content").notNull(),
  },
});

const publications = new TableDefinition("publications", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    ownerId: new ColumnDefinition("owner_id").notNull(),
    name: new ColumnDefinition("name").notNull(),
    description: new ColumnDefinition("description"),
  },
});

describe("RelationsDefinition", () => {
  it("should serialize user relations to JSON", () => {
    const userRelations = new RelationsDefinition(users, {
      // user hasMany posts
      posts: {
        target: posts,
        type: Relation.HAS_MANY,
        from: [users.columns.id],
        to: [posts.columns.authorId],
      },
      // user hasOne publications
      publication: {
        target: publications,
        type: Relation.HAS_ONE,
        from: [users.columns.id],
        to: [publications.columns.ownerId],
      },
    });

    const json = userRelations.toJSON();

    expect(json.kind).toBe("RELATIONS");
    expect(json.name).toBe("users_relations");
    expect(json.relations).toHaveProperty("posts");
    expect(json.relations).toHaveProperty("publication");

    expect(json.relations.posts.type).toBe("has_many");
    expect(json.relations.posts.target).toEqual({ kind: "TABLE", name: "posts" });
    expect(json.relations.posts.from).toEqual([{ kind: "COLUMN", name: "id" }]);
    expect(json.relations.posts.to).toEqual([{ kind: "COLUMN", name: "author_id" }]);

    expect(json.relations.publication.type).toBe("has_one");
    expect(json.relations.publication.target).toEqual({ kind: "TABLE", name: "publications" });
    expect(json.relations.publication.from).toEqual([{ kind: "COLUMN", name: "id" }]);
    expect(json.relations.publication.to).toEqual([{ kind: "COLUMN", name: "owner_id" }]);
  });
});
