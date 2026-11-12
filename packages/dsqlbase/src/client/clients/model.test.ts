import { afterEach, describe, expect, it, vi } from "vitest";
import { context, session } from "../../../mocks/context.js";
import { ModelClient } from "./model.js";

const users = new ModelClient(context, context.schema.getTable("users"));

describe("ModelClient", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("crud operations", () => {
    it("should run findOne query", async () => {
      session.mock.mockResolvedValue([{ id: "123", name: "John Doe" }]);

      const user = await users.findOne({
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
        join: {
          feed: {
            select: { id: true },
            on: {
              photos: { select: { photoUrl: true } },
              videos: {
                select: {
                  videoUrl: true,
                  owner: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      });

      expect(user).toMatchObject({ id: "123", name: "John Doe" });
      expect(session.mock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: `SELECT "__t0"."id", "__t0"."name" FROM "users" AS "__t0" WHERE "__t0"."id" = $1 LIMIT $2`,
          params: ["123", 1],
        })
      );
    });
  });

  it("should find many records", async () => {
    // Test implementation for findMany
  });

  it("should paginate records", async () => {
    // Test implementation for paginate
  });
});
