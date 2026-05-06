import { describe, expect, it } from "vitest";
import { table } from "./table.js";
import { uuid } from "./columns/uuid.js";
import { text } from "./columns/text.js";
import { belongsTo, hasMany, relations } from "./relations.js";

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
