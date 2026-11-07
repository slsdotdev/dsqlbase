import type { AnyColumn } from "../runtime/column.js";

/** What a {@link ColumnHooks} method is called with, besides the value. */
export type ColumnHookContext = {
  /** The runtime column the value belongs to, its references already linked. */
  readonly column: AnyColumn;
  /**
   * On a read: the raw row the value came from, keyed by column name — the root row, a joined
   * level, or a union branch. It carries the column's `dependsOn`, which core projects with it.
   * Absent on a write or a filter.
   */
  readonly row?: Readonly<Record<string, unknown>>;
};

/**
 * Transforms around a column's codec that need more than the value: the runtime column — its
 * table, its references — and, on a read, the row. Declared on a definition, run only by the
 * runtime `Column`, so never for a definition's `.default()`: a DDL default has no runtime
 * column.
 *
 * | Path | Order |
 * |---|---|
 * | insert, update, `$onCreate`, `$onUpdate` | `validator.write` → `write` → `codec.encode` |
 * | filters (`Column.param`) | `write` → `codec.encode` |
 * | reads, root and joined (`Column.resolve`) | `codec.decode` → `read` → `validator.read` |
 *
 * Both sides of a relation pair must carry the same hooks object, and a column with hooks must
 * reference one target: `validateSchema` refuses otherwise, since the value read through the
 * column depends on what it references.
 */
export type ColumnHooks<TValue> = {
  /** A value decoded from the row, as the client returns it. `NULL` never reaches it. */
  read?(value: TValue, context: ColumnHookContext): TValue;
  /** A value bound for the column — a write or a filter — before it is encoded. */
  write?(value: TValue, context: ColumnHookContext): TValue;
};
