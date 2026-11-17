import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./create.js";
import { schema, session } from "../../mocks/context.js";
import { ModelClient } from "./clients/model.js";
import { encodeGlobalId } from "../schema/utils/global-id.js";

describe("createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mock.mockResolvedValue([]);
  });

  it("attaches one model per table, keyed by the schema alias", () => {
    const dsql = createClient({ schema, session });

    expect(dsql.users).toBeInstanceOf(ModelClient);
    expect(dsql.posts).toBeInstanceOf(ModelClient);
    expect(dsql.posts).not.toBe(dsql.users);
  });

  // SchemaRegistry keys tables by both alias and table name, so the previous attachment
  // loop created a second, unreachable-by-type model under the database name.
  it("does not attach a model under the database table name", () => {
    const dsql = createClient({ schema, session });

    expect(Object.hasOwn(dsql, "team_members")).toBe(false);
  });

  it("binds each model to its own table", async () => {
    const dsql = createClient({ schema, session });

    await dsql.teamMembers.findMany({ select: { role: true } });

    expect(session.mock).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('FROM "team_members"') })
    );
  });

  it("binds each union to it's own client", async () => {
    const dsql = createClient({ schema, session });

    await dsql.media.findMany({ select: { id: true } });

    expect(session.mock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          'SELECT row_to_json("__j0".*) AS "data", "__j0"."__type" FROM'
        ),
      })
    );
    expect(session.mock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          'UNION ALL SELECT row_to_json("__j1".*) AS "data", "__j1"."__type" FROM'
        ),
      })
    );
  });

  it("fetches record by global id", async () => {
    const dsql = createClient({ schema, session });
    const guid = encodeGlobalId("users", { id: "1" });

    await dsql.$findByGlobalId(guid);
    expect(session.mock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('FROM "users" AS "__t0" WHERE "__t0"."id" = $1'),
      })
    );
  });

  it("refuses global ids for unions", () => {
    const dsql = createClient({ schema, session });
    const guid = encodeGlobalId("media", { id: "1" });

    expect(() => dsql.$findByGlobalId(guid)).toThrow("Table not found: media");
  });
});
