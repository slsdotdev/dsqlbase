export type DateTimeMode = "iso" | "string" | "date";

export const safeParseDate = (value: unknown) => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);

    if (isNaN(parsed)) {
      throw new Error(`Invalid date string: ${value}`);
    }

    return new Date(parsed);
  }

  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      throw new Error(`Invalid Date object: ${value}`);
    }

    return value;
  }

  throw new Error(`Unsupported date value: ${value}`);
};

export const utcDate = (date: Date) => {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Formats a `Date` for a Postgres `timestamp` / `timestamp with time zone` literal.
 *
 * - `tz: true`  → ISO 8601 in UTC (e.g. `"2026-04-30T09:00:00.000Z"`). Postgres normalises
 *   to an absolute instant on insert; downstream reads are session-zone agnostic.
 * - `tz: false` → space-separated **local wall clock** (e.g. `"2026-04-30 12:00:00.000"`).
 *   The literal value the caller wrote is the literal value Postgres stores. There is
 *   no zone metadata, so `getTime()` parity across machines is not preserved — that is
 *   the contract of `timestamp without time zone`.
 */
export const formatTimestamp = (date: Date, opts: { tz: boolean }) => {
  if (opts.tz) {
    return date.toISOString();
  }

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}`
  );
};

/**
 * Formats a `Date` as a Postgres `date` literal `YYYY-MM-DD` using the **local**
 * components of the input — Postgres `date` has no timezone concept, so we preserve
 * the wall-clock day the caller authored.
 */
export const formatDate = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Formats a `Date`'s time-of-day for a Postgres `time` / `time with time zone` literal.
 *
 * - `tz: true`  → UTC components with a trailing `Z` (e.g. `"09:00:00.000Z"`), mirroring
 *   the absolute-instant convention used for `timestamp with time zone`.
 * - `tz: false` → local clock components (e.g. `"12:00:00.000"`), wall-clock semantics.
 */
export const formatTime = (date: Date, opts: { tz: boolean }) => {
  if (opts.tz) {
    return (
      `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}` +
      `.${pad(date.getUTCMilliseconds(), 3)}Z`
    );
  }

  return (
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}`
  );
};
