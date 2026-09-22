import { describe, expect, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import { createClient } from "./create.js";
import { ModelClient } from "./model/client.js";
import { relations, hasMany, table, text, uuid } from "../schema/index.js";

const teams = table("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

// Exported below as `members`, so the schema alias differs from the table name — the
// shape the e2e fixture uses.
const teamMembers = table("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  role: text("role").notNull(),
});

const teamRelations = relations(teams, {
  members: hasMany(teamMembers, {
    from: [teams.columns.id],
    to: [teamMembers.columns.teamId],
  }),
});

const schema = { teams, members: teamMembers, teamRelations };

const createMockSession = (): Session => ({ execute: vi.fn().mockResolvedValue([]) }) as Session;

describe("createClient", () => {
  it("attaches one model per table, keyed by the schema alias", () => {
    const dsql = createClient({ schema, session: createMockSession() });

    expect(dsql.teams).toBeInstanceOf(ModelClient);
    expect(dsql.members).toBeInstanceOf(ModelClient);
    expect(dsql.teams).not.toBe(dsql.members);
  });

  // SchemaRegistry keys tables by both alias and table name, so the previous attachment
  // loop created a second, unreachable-by-type model under the database name.
  it("does not attach a model under the database table name", () => {
    const dsql = createClient({ schema, session: createMockSession() });

    expect(Object.hasOwn(dsql, "team_members")).toBe(false);
  });

  it("attaches exactly one model per table", () => {
    const dsql = createClient({ schema, session: createMockSession() });

    const models = Object.entries(dsql).filter(([, value]) => value instanceof ModelClient);

    expect(models.map(([alias]) => alias).sort()).toEqual(["members", "teams"]);
  });

  it("attaches models as non-writable enumerable properties", () => {
    const dsql = createClient({ schema, session: createMockSession() });
    const descriptor = Object.getOwnPropertyDescriptor(dsql, "members");

    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.enumerable).toBe(true);
  });

  it("binds each model to its own table", async () => {
    const session = createMockSession();
    const dsql = createClient({ schema, session });

    await dsql.members.findMany({ select: { role: true } });

    expect(session.execute).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('FROM "team_members"') })
    );
  });
});
