import type { StandardSchemaIssue } from "./standard-schema.js";

/**
 * - `invalid` — the value failed the column's schema.
 * - `not_json` — the schema's output has no JSON form (a `bigint`, a function, `undefined`).
 * - `unstable` — the schema's output, stored, does not read back as itself: the schema
 *   transforms values, which a stored column cannot support.
 * - `async` — the schema validated asynchronously; a column's codec is synchronous.
 */
export type ColumnValidationErrorCode = "invalid" | "not_json" | "unstable" | "async";

/** A value refused by a column's schema, on a write or on a read. */
export class ColumnValidationError extends Error {
  readonly code: ColumnValidationErrorCode;
  /** The database column name. */
  readonly column: string;
  readonly phase: "write" | "read";
  readonly issues: readonly StandardSchemaIssue[];

  constructor(
    code: ColumnValidationErrorCode,
    column: string,
    phase: "write" | "read",
    issues: readonly StandardSchemaIssue[] = []
  ) {
    super(describe(code, column, phase, issues));
    this.name = "ColumnValidationError";
    this.code = code;
    this.column = column;
    this.phase = phase;
    this.issues = issues;
  }
}

function describe(
  code: ColumnValidationErrorCode,
  column: string,
  phase: "write" | "read",
  issues: readonly StandardSchemaIssue[]
): string {
  switch (code) {
    case "invalid":
      return `Invalid value for column "${column}" on ${phase}: ${issues.map(formatIssue).join("; ")}`;
    case "not_json":
      return `The schema of column "${column}" produced a value with no JSON form.`;
    case "unstable":
      return (
        `The schema of column "${column}" is not stable: its output does not read back as ` +
        `itself. Defaults, coercion and refinements are supported; transforms are not.`
      );
    case "async":
      return (
        `The schema of column "${column}" validated asynchronously; ` +
        `a column's schema must validate synchronously.`
      );
  }
}

function formatIssue(issue: StandardSchemaIssue): string {
  const path = (issue.path ?? [])
    .map((segment) => String(typeof segment === "object" ? segment.key : segment))
    .join(".");

  return path ? `${path}: ${issue.message}` : issue.message;
}
