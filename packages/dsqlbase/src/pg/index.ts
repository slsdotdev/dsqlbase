import { Session, SQLStatement, TransactionSession } from "@dsqlbase/core";
import { Pool, PoolClient } from "pg";

export class PGSession implements Session {
  private _client: Pool;

  constructor(client: Pool) {
    this._client = client;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }

  async beginTransaction(): Promise<TransactionSession> {
    const client = await this._client.connect();
    await client.query("BEGIN");
    return new PGTransactionSession(client);
  }
}

export class PGTransactionSession implements TransactionSession {
  private _client: PoolClient;

  constructor(client: PoolClient) {
    this._client = client;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }

  async commit(): Promise<void> {
    await this._client.query("COMMIT");
    this._client.release();
  }

  async rollback(): Promise<void> {
    await this._client.query("ROLLBACK");
    this._client.release();
  }
}

export function createPgSession(client: Pool): PGSession {
  return new PGSession(client);
}
