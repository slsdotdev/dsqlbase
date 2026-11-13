import { afterEach, describe, expect, it, vi } from "vitest";
import { context, session } from "../../../mocks/context.js";
import { ModelClient as ModelClientV1 } from "../.v1/model/client.js";
import { ModelClient } from "./model.js";

describe("ModelClient", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("crud operations", () => {
    it("matches findOne query between versions", async () => {
      const table = context.schema.getTable("users");
      const users = new ModelClient(context, table);
      const usersV1 = new ModelClientV1(context, table);

      session.mock.mockResolvedValue([{ id: "123", name: "John Doe" }]);

      await users.findOne({
        where: { id: "123" },
        select: {
          id: true,
          name: true,
          posts: {
            comments: {
              id: true,
              author: { posts: { comments: { id: true }, author: { feed: true } } },
            },
          },
        },
      });

      await usersV1.findOne({
        where: { id: "123" },
        select: {
          id: true,
          name: true,
          posts: {
            comments: {
              id: true,
              author: { posts: { comments: { id: true }, author: { feed: true } } },
            },
          },
        },
      });

      const calls = session.mock.mock.calls;

      expect(calls).toHaveLength(2);
      expect(calls[0][0].text).toEqual(calls[1][0].text);
    });
  });

  it("retrives a record by key", async () => {
    const table = context.schema.getTable("users");
    const users = new ModelClient(context, table);

    session.mock.mockResolvedValue([{ id: "123", name: "John Doe" }]);

    await users.get({ key: { id: "123" } });

    expect(session.mock).toHaveBeenCalledWith({
      text: 'SELECT "__t0"."id", "__t0"."name" FROM "users" AS "__t0" WHERE "__t0"."id" = $1 LIMIT $2',
      params: ["123", 1],
    });
  });

  it("throws when keys not provided or invalid", () => {
    const table = context.schema.getTable("users");
    const users = new ModelClient(context, table);

    expect(() => users.get({ key: {} })).toThrow(
      `Provided keys do not match any unique key for table "users".`
    );
    // @ts-expect-error Testing invalid key scenario
    expect(() => users.get({ key: { name: "invalid" } })).toThrow(
      `Provided keys do not match any unique key for table "users". Expected one of: (id).`
    );
    expect(session.mock).not.toHaveBeenCalled();
  });

  it("should paginate records", async () => {
    // Test implementation for paginate
  });
});
