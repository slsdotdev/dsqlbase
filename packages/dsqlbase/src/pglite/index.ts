import { Session, SQLStatement, TransactionSession } from "@dsqlbase/core";
import { PGlite } from "@electric-sql/pglite";

/**
 * A session over one PGlite instance. PGlite is a single connection: while a transaction is
 * open, every query on the instance runs inside it, including one made outside `$transaction`.
 * Meant for tests and local development.
 */
export class PgLiteSession implements Session {
  private _client: PGlite;

  constructor(client: PGlite) {
    this._client = client;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }

  async beginTransaction(): Promise<TransactionSession> {
    await this._client.exec("BEGIN");

    const client = this._client;
    let ended = false;

    return {
      execute: async <T = unknown>(query: SQLStatement): Promise<T[]> => {
        const result = await client.query(query.text, query.params);
        return result.rows as T[];
      },
      commit: async () => {
        if (ended) return;
        ended = true;
        await client.exec("COMMIT");
      },
      // Never throws: the caller keeps the error that made it roll back.
      rollback: async () => {
        if (ended) return;
        ended = true;
        await client.exec("ROLLBACK").catch(() => undefined);
      },
    };
  }
}

export function createPgLiteSession(client: PGlite): PgLiteSession {
  return new PgLiteSession(client);
}
