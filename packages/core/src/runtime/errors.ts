/**
 * A tenant boundary was crossed, or could not be established.
 *
 * Thrown when an operation is *built* — when `findMany()` is called, not when the query is
 * executed — so a missing identity surfaces before anything reaches the database.
 */
export class TenancyError extends Error {
  /** The table whose tenant boundary could not be satisfied, when one table in particular is. */
  readonly table?: string;

  /** The claim that was missing, when one claim in particular was. */
  readonly claim?: string;

  constructor(message: string, table?: string, claim?: string) {
    super(message);

    this.name = "TenancyError";
    this.table = table;
    this.claim = claim;
  }
}
