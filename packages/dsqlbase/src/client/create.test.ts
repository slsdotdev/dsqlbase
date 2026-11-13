import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "./create.js";
import { schema, session } from "../../mocks/context.js";
import { ModelClient } from "./clients/model.js";

describe("createClient", () => {
  beforeEach(() => {
    session.mock.mockClear();
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
});
