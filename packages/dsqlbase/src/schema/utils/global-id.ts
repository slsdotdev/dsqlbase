/**
 * Global ids: the opaque form a row's primary key takes when it leaves the ORM.
 *
 * Deliberately **not** in `@dsqlbase/core`. Nothing below the client has an opinion about the
 * shape of an id — core sees a `uuid` column with a codec, exactly as it sees an `interval`
 * column with a `Duration` codec (`./duration.ts`). The wrapping is a client concern, so it
 * lives here with the rest of the codec helpers.
 */

/** What went wrong with a global id. */
export type GlobalIdErrorCode =
  /** The value is not a well-formed `guid:` string. */
  | "format"
  /** The value decoded, but names a table or key fields the caller did not expect. */
  | "key_mismatch"
  /** The value decoded, but its table key is not a node in this schema. */
  | "unknown_node";

/**
 * A global id could not be read, or does not point where it was used.
 *
 * `key_mismatch` is the one that earns the format its keep: a wrapped `workspaces` id handed
 * to a `users.id` filter is caught here, where a bare uuid would simply have matched nothing.
 */
export class GlobalIdError extends Error {
  readonly code: GlobalIdErrorCode;

  constructor(code: GlobalIdErrorCode, message: string) {
    super(message);

    this.name = "GlobalIdError";
    this.code = code;
  }
}

/**
 * The prefix every global id carries.
 *
 * It is what makes "is this already wrapped?" an exact question rather than a heuristic: a
 * uuid never starts with `guid:`, so a column can accept both forms without guessing.
 */
export const GLOBAL_ID_PREFIX = "guid:";

/** A decoded global id: the table it names, and the primary key it carries. */
export interface GlobalId {
  /** The node key — the schema alias of the table, unless the column overrode it. */
  readonly key: string;

  /** The primary key, by **field** name (`teamId`), not by database column name (`team_id`). */
  readonly pk: Record<string, string>;
}

/**
 * Wraps a primary key as an opaque global id.
 *
 * The payload is `[key, pk]`, JSON-encoded and base64url-wrapped. `pk` is an object rather
 * than a bare value so the key field is named rather than assumed to be `id`, and so the
 * format never has to change to carry a composite key — today nothing produces one, because
 * only a single-column `guid()` key can be declared.
 *
 * Both the table key and the pk field names are **aliases**: the names the client addresses
 * (`members`, not `team_members`), so an id follows the client-visible identity rather than
 * the physical one and a database rename does not invalidate ids in the wild.
 */
export function encodeGlobalId(key: string, pk: Record<string, string>): string {
  const payload = JSON.stringify([key, pk]);

  return `${GLOBAL_ID_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

/** Whether a value is a global id rather than a raw column value. */
export function isGlobalId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(GLOBAL_ID_PREFIX);
}

/**
 * Reads a global id back into its table key and primary key.
 *
 * `expectedKey` is the wrong-table safety net: pass it wherever the caller already knows which
 * table the id has to name — a `guid` column's own key, say — and a wrapped id from another
 * table throws instead of quietly matching nothing.
 *
 * The payload is never trusted. Whether the decoded fields are actually that table's primary
 * key is a separate question, answered against the registry by the caller.
 */
export function decodeGlobalId(value: string, expectedKey?: string): GlobalId {
  if (!isGlobalId(value)) {
    throw new GlobalIdError(
      "format",
      `"${value}" is not a global id: it has no "${GLOBAL_ID_PREFIX}" prefix.`
    );
  }

  const payload = decodePayload(value);

  if (!Array.isArray(payload) || payload.length !== 2) {
    throw new GlobalIdError("format", `"${value}" does not carry a [key, pk] payload.`);
  }

  const [key, pk] = payload as [unknown, unknown];

  if (typeof key !== "string" || key.length === 0) {
    throw new GlobalIdError("format", `"${value}" does not name a table.`);
  }

  if (!isPlainRecord(pk) || Object.keys(pk).length === 0) {
    throw new GlobalIdError("format", `"${value}" does not carry a primary key.`);
  }

  for (const [field, fieldValue] of Object.entries(pk)) {
    if (typeof fieldValue !== "string") {
      throw new GlobalIdError(
        "format",
        `"${value}" carries a non-string value for key field "${field}".`
      );
    }
  }

  if (expectedKey !== undefined && key !== expectedKey) {
    throw new GlobalIdError(
      "key_mismatch",
      `Global id names "${key}", but "${expectedKey}" was expected here.`
    );
  }

  return { key, pk: pk as Record<string, string> };
}

function decodePayload(value: string): unknown {
  // `Buffer.from(..., "base64url")` never throws — it drops whatever it cannot read — so
  // malformed base64 surfaces here as JSON that does not parse rather than as a decode error.
  const json = Buffer.from(value.slice(GLOBAL_ID_PREFIX.length), "base64url").toString("utf8");

  try {
    return JSON.parse(json);
  } catch {
    throw new GlobalIdError("format", `"${value}" does not decode to a JSON payload.`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
