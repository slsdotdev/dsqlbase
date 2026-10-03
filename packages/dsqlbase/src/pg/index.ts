import { Session, SQLStatement, TransactionSession } from "@dsqlbase/core";
import type { Pool, PoolClient } from "pg";

/**
 * Whether the connection is still usable after `error`: the server answered (the error has a
 * SQLSTATE, as a failed `COMMIT` with `40001` does), rather than the connection breaking.
 */
function connectionSurvives(error: unknown): boolean {
  return typeof (error as { code?: unknown } | null)?.code === "string";
}

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

    try {
      await client.query("BEGIN");
    } catch (error) {
      client.release(connectionSurvives(error) ? undefined : toError(error));
      throw error;
    }

    return new PGTransactionSession(client);
  }
}

/**
 * One pooled connection holding an open transaction. `commit` and `rollback` each end it and
 * return the connection to the pool exactly once, whether they succeed or not; a connection
 * that broke is destroyed rather than returned. After either, the other is a no-op.
 */
export class PGTransactionSession implements TransactionSession {
  private _client: PoolClient;
  private _released = false;

  constructor(client: PoolClient) {
    this._client = client;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }

  /** Throws what `COMMIT` threw (a `40001` included); the transaction is over either way. */
  async commit(): Promise<void> {
    if (this._released) return;

    try {
      await this._client.query("COMMIT");
    } catch (error) {
      this._release(connectionSurvives(error) ? undefined : error);
      throw error;
    }

    this._release();
  }

  /**
   * Never throws: a `ROLLBACK` that fails means the connection broke, and destroying it ends
   * the transaction on the server. The caller keeps the error that made it roll back.
   */
  async rollback(): Promise<void> {
    if (this._released) return;

    try {
      await this._client.query("ROLLBACK");
      this._release();
    } catch (error) {
      this._release(error);
    }
  }

  private _release(error?: unknown) {
    this._released = true;
    this._client.release(error === undefined ? undefined : toError(error));
  }
}

/** `release(err)` destroys the connection only for a truthy error. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createPgSession(client: Pool): PGSession {
  return new PGSession(client);
}
