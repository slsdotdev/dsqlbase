/**
 * Keyset cursors: the position of one row under one total order.
 *
 * A cursor carries the database's own text for each order key — never a decoded JS value,
 * which may have lost precision the database still compares on — plus a signature of the
 * order it was taken under. It carries no `where`, `select` or `join`: the caller supplies those
 * again on every page, so a cursor grants nothing a `where` value could not.
 */
import { createHash } from "node:crypto";

/** What was wrong with a cursor. */
export type InvalidCursorCode =
  /** Not a readable cursor at all. */
  | "format"
  /** A cursor from another version of the format. */
  | "version"
  /** A readable cursor taken under another table or another order. */
  | "mismatch";

/**
 * A cursor could not be used for this page.
 *
 * Thrown before any SQL is built. `mismatch` is the one a caller is most likely to meet: a
 * cursor reused after the `orderBy` changed, or handed to another model.
 */
export class InvalidCursorError extends Error {
  readonly code: InvalidCursorCode;

  constructor(code: InvalidCursorCode, message: string) {
    super(message);

    this.name = "InvalidCursorError";
    this.code = code;
  }
}

/** The format version every cursor this build writes starts with. */
export const CURSOR_PREFIX = "c1.";

const VERSIONED = /^c\d+\./;

/** One key of the total order a cursor is taken under. */
export interface CursorKey {
  field: string;
  direction: "asc" | "desc";
}

/**
 * The first 8 hex characters of SHA-256 over the table alias and the ordered keys.
 *
 * Enough to tell one order from another by accident; not a secret, and not meant to be — a
 * forged cursor is only another position, and tenancy predicates apply to it regardless.
 */
export function keysetSignature(alias: string, keys: CursorKey[]): string {
  const order = keys.map(({ field, direction }) => `${field}:${direction}`).join(",");

  return createHash("sha256").update(`${alias}|${order}`).digest("hex").slice(0, 8);
}

/** `c1.` + base64url of the JSON `[signature, ...values]`. */
export function encodeCursor(signature: string, values: (string | null)[]): string {
  const payload = JSON.stringify([signature, ...values]);

  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

/**
 * Reads a cursor back into its key values, refusing one taken under any order other than
 * `signature` or carrying a different number of keys.
 */
export function decodeCursor(
  cursor: string,
  signature: string,
  keyCount: number
): (string | null)[] {
  if (typeof cursor !== "string" || !VERSIONED.test(cursor)) {
    throw new InvalidCursorError("format", `"${String(cursor)}" is not a cursor.`);
  }

  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new InvalidCursorError(
      "version",
      `"${cursor}" is from another cursor format; this client reads "${CURSOR_PREFIX}".`
    );
  }

  const payload = decodePayload(cursor);

  if (!Array.isArray(payload) || typeof payload[0] !== "string") {
    throw new InvalidCursorError(
      "format",
      `"${cursor}" does not carry a [signature, ...] payload.`
    );
  }

  const [taken, ...values] = payload as [string, ...unknown[]];

  if (taken !== signature || values.length !== keyCount) {
    throw new InvalidCursorError(
      "mismatch",
      `"${cursor}" was taken under another table or order; pass the same orderBy it came from.`
    );
  }

  for (const value of values) {
    if (typeof value !== "string" && value !== null) {
      throw new InvalidCursorError("format", `"${cursor}" carries a key that is not text.`);
    }
  }

  return values as (string | null)[];
}

function decodePayload(cursor: string): unknown {
  // `Buffer.from(..., "base64url")` never throws — it drops whatever it cannot read — so
  // malformed base64 surfaces here as JSON that does not parse.
  const json = Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");

  try {
    return JSON.parse(json);
  } catch {
    throw new InvalidCursorError("format", `"${cursor}" does not decode to a JSON payload.`);
  }
}
