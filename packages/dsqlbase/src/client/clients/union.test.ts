import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, session } from "../../../mocks/context.js";
import { UnionClient } from "./union.js";

const union = context.schema.getUnion("media");
const client = new UnionClient(context, union);

describe("UnionClient", () => {
  beforeEach(() => {
    session.mock.mockResolvedValue([]);
  });

  afterEach(() => {
    session.mock.mockReset();
  });
  it("reads every member as one list", async () => {
    session.mock.mockResolvedValue([
      {
        data: {
          $$key: "photos",
          id: "p1",
          user_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          photo_url: "a",
        },
      },
      {
        data: {
          $$key: "videos",
          id: "v1",
          user_id: "u1",
          created_at: "2026-01-02T00:00:00Z",
          video_url: "b",
        },
      },
    ]);

    const results = await client.findMany({
      where: { userId: { eq: "u1" } },
      orderBy: { createdAt: "desc" },
    });

    const { text } = session.mock.mock.calls[0][0];

    expect(text).toMatch(/^SELECT row_to_json\("__j0"\.\*\) AS "data"/);
    expect(text).toContain(`WHERE "__t0"."user_id" = $1`);
    expect(text).toContain(`WHERE "__t1"."user_id" = $2`);

    expect(results[1]?.createdAt).toEqual(new Date("2026-01-02T00:00:00Z"));
  });

  // Will be replaced with get
  it.skip("requires findOne to name its row", () => {
    expect(() => client.findOne({ where: {} })).toThrow(/findOne on union "media" needs a where/);
  });

  it("prunes members by $$key at the top level too", async () => {
    await client.findMany({ on: { photos: false } });
    const { text } = session.mock.mock.calls[0][0];

    expect(text).not.toContain('"photos"');
  });

  it("counts across members", async () => {
    session.mock.mockResolvedValue([{ count: "5" }]);

    const count = await client.count({ where: { userId: { exists: true } } });

    expect(session.mock.mock.calls[0][0].text).toBe(
      'SELECT (SELECT count(*) FROM "photos" AS "__t0" WHERE "__t0"."user_id" IS NOT NULL) + ' +
        '(SELECT count(*) FROM "videos" AS "__t0" WHERE "__t0"."user_id" IS NOT NULL) AS "count"'
    );
    expect(count).toBe(5);
  });
});
