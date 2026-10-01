import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { ColumnValidationError } from "../../schema/utils/column-validation.js";
import type { StandardSchemaV1 } from "../../schema/utils/standard-schema.js";
import { belongsTo, jsonb, relations, table, text, uuid } from "../../schema/index.js";

type Settings = { theme: "light" | "dark" };

const settings: StandardSchemaV1<{ theme?: "light" | "dark" }, Settings> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const theme = (value as { theme?: unknown }).theme ?? "light";
      return theme === "light" || theme === "dark"
        ? { value: { theme } }
        : { issues: [{ message: "expected light or dark", path: ["theme"] }] };
    },
  },
};

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  settings: jsonb("settings").schema(settings),
});

const posts = table("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").notNull(),
});

const postRelations = relations(posts, {
  author: belongsTo(users, { from: [posts.columns.authorId], to: [users.columns.id] }),
});

const schema = { users, posts, postRelations };

describe("a jsonb column with a schema, through the client", () => {
  let calls: SQLStatement[];
  let rows: Record<string, unknown>[];
  let dsql: ReturnType<typeof createClient<typeof schema>>;

  beforeEach(() => {
    calls = [];
    rows = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return rows;
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
  });

  it("writes the validated output on create and update", async () => {
    await dsql.users.create({ data: { name: "Ada", settings: {} } });
    await dsql.users.update({ where: { name: "Ada" }, set: { settings: { theme: "dark" } } });

    expect(calls[0]?.params).toContain('{"theme":"light"}');
    expect(calls[1]?.params).toContain('{"theme":"dark"}');
  });

  it("writes null as SQL NULL, without validating it", async () => {
    await dsql.users.update({ where: { name: "Ada" }, set: { settings: null } });

    expect(calls[0]?.params).toContain(null);
  });

  it("refuses an invalid value before any SQL runs", () => {
    expect(() =>
      dsql.users.create({
        // @ts-expect-error not a theme
        data: { name: "Ada", settings: { theme: "blue" } },
      })
    ).toThrow(ColumnValidationError);
    expect(calls).toHaveLength(0);
  });

  it("validates each read, the output filling what the row left out", async () => {
    rows = [{ id: "u1", name: "Ada", settings: {} }];

    const user = await dsql.users.findOne({ where: { id: "u1" } });

    expect(user?.settings).toEqual({ theme: "light" });
  });

  it("validates a row reached through a join", async () => {
    rows = [{ id: "p1", author_id: "u1", author: { id: "u1", name: "Ada", settings: {} } }];

    const post = await dsql.posts.findOne({ where: { id: "p1" }, join: { author: true } });

    expect(post?.author?.settings).toEqual({ theme: "light" });
  });

  it("fails the read on a stored row the schema refuses", async () => {
    rows = [{ id: "u1", name: "Ada", settings: { theme: "blue" } }];

    await expect(dsql.users.findMany({})).rejects.toThrow(
      'Invalid value for column "settings" on read: theme: expected light or dark'
    );
  });
});
