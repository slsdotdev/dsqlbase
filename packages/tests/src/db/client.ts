import { PGlite } from "@electric-sql/pglite";
import { SQLStatement } from "@dsqlbase/core";
import { Schema, Session } from "@dsqlbase/core/runtime";
import { createClient } from "@dsqlbase/client";
import * as schema from "./schema.js";

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
  const pg = new PGlite("memory://", { debug: 1 });
  const dsql = createClient({ schema, session: new MockSession(pg) });

  return Object.assign(dsql, { close: () => pg.close() });
};

export type ClientSchema = Schema<typeof schema>;
export type TestClient = ReturnType<typeof createTestClient>;
