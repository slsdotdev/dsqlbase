import { afterEach, describe, expect, it, vi } from "vitest";
import { context, session } from "../../../mocks/context.js";
import { ModelClient as ModelClientV1 } from "../.v1/model/client.js";
import { ModelClient } from "./model.js";

describe("ModelClient", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("crud operations", () => {
    it("should run findOne query", async () => {
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

  it("should find many records", async () => {
    // Test implementation for findMany
  });

  it("should paginate records", async () => {
    // Test implementation for paginate
  });
});
