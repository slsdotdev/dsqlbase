import { SQLStatement } from "@dsqlbase/core/sql";
import { Session } from "@dsqlbase/core/driver";
import { ExecutionContext, QueryDialect, SchemaRegistry } from "@dsqlbase/core/execution";
import { PGlite } from "@electric-sql/pglite";

import { schema } from "../schema/index.js";

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

export const createClient = async () => {
  const pg = new PGlite("memory://", { debug: 0 });

  const session = new MockSession(pg);
  const registry = new SchemaRegistry(schema);

  const context = new ExecutionContext({
    session,
    dialect: new QueryDialect(),
    schema: registry,
  });

  return {
    context,
    tables: registry.getTables(),
    close: async () => {
      await pg.close();
    },
  };
};
