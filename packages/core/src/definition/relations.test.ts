import { describe, expect, it } from "vitest";
import { TableDefinition } from "./table.js";
import { ColumnDefinition } from "./column.js";
import { RelationsDefinition } from "./relations.js";

// #region Tables

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

// const publicationMemberships = new TableDefinition("publication_memberships", {
//   columns: {
//     publicationId: new ColumnDefinition("publication_id").notNull(),
//     userId: new ColumnDefinition("user_id").notNull(),
//     role: new ColumnDefinition("role").notNull(),
//   },
// });

// #endregion Table Definitions

// #region Relations

// const postRelations = new RelationsDefinition(posts.name, {
//   table: posts,
//   relations: {
//     // post belongsTo user
//     author: {
//       target: users,
//       type: "belongs_to",
//       from: [posts["_columns"].authorId],
//       to: [users["_columns"].id],
//     },
//     // post belongsTo publication
//     publication: {
//       target: publications,
//       type: "belongs_to",
//       from: [posts["_columns"].publicationId],
//       to: [publications["_columns"].id],
//     },
//   },
// });

// const publicationRelations = new RelationsDefinition(publications.name, {
//   table: publications,
//   relations: {
//     // publication belongsTo user
//     owner: {
//       target: users,
//       type: "belongs_to",
//       from: [publications["_columns"].ownerId],
//       to: [users["_columns"].id],
//     },
//     // publication hasMany posts
//     posts: {
//       target: posts,
//       type: "has_many",
//       from: [publications["_columns"].id],
//       to: [posts["_columns"].publicationId],
//     },
//     // publication hasMany members
//     members: {
//       target: publicationMemberships,
//       type: "has_many",
//       from: [publications["_columns"].id],
//       to: [publicationMemberships["_columns"].publicationId],
//     },
//   },
// });

// const publicationMembershipRelations = new RelationsDefinition(publicationMemberships.name, {
//   table: publicationMemberships,
//   relations: {
//     // membership belongsTo publication
//     publication: {
//       target: publications,
//       type: "belongs_to",
//       from: [publicationMemberships["_columns"].publicationId],
//       to: [publications["_columns"].id],
//     },
//     // membership belongsTo user
//     user: {
//       target: users,
//       type: "belongs_to",
//       from: [publicationMemberships["_columns"].userId],
//       to: [users["_columns"].id],
//     },
//   },
// });

// #endregion Relations Definitions

describe("RelationsDefinition", () => {
  it("should serialize user relations to JSON", () => {
    const userRelations = new RelationsDefinition(users.name, {
      table: users,
      relations: {
        // user hasMany posts
        posts: {
          target: posts,
          type: "has_many",
          from: [users["_columns"].id],
          to: [posts["_columns"].authorId],
        },
        // user hasOne publications
        publication: {
          target: publications,
          type: "has_one",
          from: [users["_columns"].id],
          to: [publications["_columns"].ownerId],
        },
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
