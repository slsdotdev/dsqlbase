import { SQLStatement } from "../sql/nodes.js";

/**
 * Defines the Session interface for executing SQL queries and managing transactions.
 *
 * This interface abstracts the underlying driver connection and provides methods
 * for executing queries and handling transactions.
 */

export type Session = {
  execute<T = unknown>(query: SQLStatement): Promise<T[]>;
  beginTransaction?(): Promise<TransactionSession>;
};

/**
 * Defines the TransactionSession interface, which extends the Session interface with
 * additional methods for committing and rolling back transactions.
 *
 * This interface is used when a transaction is active, allowing the caller to
 * manage the transaction lifecycle explicitly.
 *
 * `commit` and `rollback` each end the transaction and free whatever it holds (a pooled
 * connection) whether they succeed or not; after either, the other is a no-op. `commit` throws
 * what the database answered, a `40001` included. `rollback` should not throw: it runs after
 * another error, which is the one the caller needs, and `$transaction` ignores a rollback
 * failure.
 */

export type TransactionSession = {
  commit(): Promise<void>;
  rollback(): Promise<void>;
} & Session;
