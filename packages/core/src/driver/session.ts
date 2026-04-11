import { SQLStatement } from "../sql/nodes.js";

/**
 * Defines the Session interface for executing SQL queries and managing transactions.
 *
 * This interface abstracts the underlying driver connection and provides methods
 * for executing queries and handling transactions.
 */

export interface Session {
  execute<T = unknown>(query: SQLStatement): Promise<T[]>;
  beginTransaction?(): Promise<TransactionSession>;
}

/**
 * Defines the TransactionSession interface, which extends the Session interface with
 * additional methods for committing and rolling back transactions.
 *
 * This interface is used when a transaction is active, allowing the caller to
 * manage the transaction lifecycle explicitly.
 */

export interface TransactionSession extends Session {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
