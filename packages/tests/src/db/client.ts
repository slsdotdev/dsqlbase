import { PGlite } from "@electric-sql/pglite";
import { SQLStatement } from "@dsqlbase/core";
import { Schema, Session } from "@dsqlbase/core/runtime";
import { createClient } from "@dsqlbase/client";
import { schema } from "./schema";

class MockSession implements Session {
  private _client: PGlite;

  constructor(pg: PGlite) {
    this._client = pg;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }
}

export const createTestClient = () => {
  const pg = new PGlite("memory://", { debug: 0 });
  const session = new MockSession(pg);
  const dsql = createClient({ schema, session });

  return Object.assign(dsql, { session, pg, close: () => pg.close() });
};

export type ClientSchema = Schema<typeof schema>;
export type TestClient = ReturnType<typeof createTestClient>;
