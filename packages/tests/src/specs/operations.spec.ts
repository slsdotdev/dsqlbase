import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, seedData, type TestClient } from "../client/index.js";
import { sql } from "@dsqlbase/core";

describe("CRUD Operations", () => {
  let client: TestClient;

  beforeAll(async () => {
    client = await createClient();
    await seedData(client.pg);
  });

  afterAll(async () => {
    await client.close();
  });

  it("should perform a select operation", async () => {
    const operation = client.context.operations.createSelect(client.tables.projects, {
      args: {
        select: {
          id: true,
          teamId: true,
          name: true,
          isArchived: true,
        },
        where: {
          and: [
            { or: [{ name: { like: "%API%" } }, { name: { like: "%Web%" } }] },
            { isArchived: { ne: true } },
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
      },
    });

    const results = await client.context.session.execute(operation.query);

    expect(results).toBeInstanceOf(Array);
    expect(results).toHaveLength(1);
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
    `.toQuery();

    const results = await client.context.session.execute<Record<string, unknown>>(query);

    const taskWithAssignee = results.filter((r) => r.assignee !== null);

    expect(results).toHaveLength(6);
    expect(taskWithAssignee).toHaveLength(5);
  });
});
