import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, seedData, type TestClient } from "../db/index.js";
import { sql } from "@dsqlbase/core";
import { applyMigrations } from "../db/migrate.js";

describe("CRUD Operations", () => {
  let client: TestClient;
  let data: Awaited<ReturnType<typeof seedData>>;

  beforeAll(async () => {
    client = createTestClient();

    await applyMigrations(client);
    data = await seedData(client);
  });

  afterAll(async () => {
    await client.close();
  });

  it("should perform a select operation", async () => {
    const result = await client.projects.findMany({
      select: {
        id: true,
        teamId: true,
        name: true,
        isArchived: true,
      },
      where: {
        and: [
          { or: [{ name: { contains: "API" } }, { name: { contains: "Web" } }] },
          { isArchived: { neq: true } },
        ],
      },
      join: {
        tasks: {
          select: {
            id: true,
            title: true,
            description: true,
          },
          where: {
            dueDate: { lt: new Date("2024-01-01") },
          },
          limit: 5,
          orderBy: { dueDate: "asc" },
          join: {
            assignee: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    expect(result).toBeInstanceOf(Array);
    expect(result).toHaveLength(1);
  });

  it("should run a join raw query", async () => {
    const query = sql`
      SELECT "id", "title", "description", "__rel_assignee"."data" AS "assignee" FROM "tasks" 
      LEFT JOIN LATERAL (
        SELECT row_to_json("__t".*) AS "data" 
        FROM (
          SELECT "id", "name", "email" 
          FROM "users" 
          WHERE "users"."id" = "tasks"."assignee_id"
        ) AS "__t"
      ) AS "__rel_assignee" 
      ON true
    `;

    const results = await client.$raw<{
      id: string;
      title: string;
      description: string;
      assignee: { id: string; name: string; email: string } | null;
    }>(query);

    const taskWithAssignee = results.filter((r) => r.assignee !== null);

    expect(results).toHaveLength(6);
    expect(taskWithAssignee).toHaveLength(5);
  });

  it("should run a select operation with join", async () => {
    const result = await client.users.findOne({
      select: { id: true, name: true },
      where: { id: { eq: data.users[1].id } },
      join: {
        tasks: {
          select: { title: true, dueDate: true },
          where: { dueDate: { exists: true } },
          join: {
            project: {
              select: { name: true },
            },
          },
        },
      },
    });

    console.dir(result, { depth: 10 });

    expect(result).toMatchObject({
      id: data.users[1].id,
      name: data.users[1].name,
      tasks: expect.arrayContaining([
        expect.objectContaining({
          title: expect.any(String),
          dueDate: expect.any(Date),
          project: expect.objectContaining({
            name: expect.any(String),
          }),
        }),
      ]),
    });
  });
});
