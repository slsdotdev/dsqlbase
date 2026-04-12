import { afterAll, beforeAll, describe, it } from "vitest";
import { createClient } from "../client/client.js";

describe("CRUD Operations", () => {
  let client: Awaited<ReturnType<typeof createClient>>;

  beforeAll(async () => {
    client = await createClient();
  });

  afterAll(async () => {
    await client.close();
  });

  it("should perform a select operation", async () => {
    const operation = client.context.operations.createSelect(client.tables.projects, {
      args: {
        select: { teamId: true, name: true },
        where: { isArchived: { ne: true } },
      },
    });

    await client.context.session.execute(operation.query);
  });
});
