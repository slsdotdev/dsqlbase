/** The marker a failing check raises, decoded back into a {@link PolicyViolationError}. */
export const POLICY_MARKER = "dsqlbase.policy";

const MARKER_PATTERN = /"dsqlbase\.policy:([^:"]*):(restrictive|permissive):([^"]*)"/;

/**
 * A write refused by a row policy's check: the statement failed, and nothing it would have
 * written was written. Reads are never refused — a policy's `using` only filters rows.
 *
 * The message names the table and the policy, never a row's values. The driver's error is
 * `cause`.
 */
export class PolicyViolationError extends Error {
  /** The schema alias of the table written to. */
  readonly table: string;
  /** `insert` or `update`. */
  readonly command: string;
  /** Which part of the check failed: one restrictive policy, or the permissive ones together. */
  readonly as: "restrictive" | "permissive";
  /**
   * The policies that part names: the one restrictive policy, or every permissive policy for
   * the command — empty when there is none, which denies by default.
   */
  readonly policies: readonly string[];

  constructor(
    details: {
      table: string;
      command: string;
      as: "restrictive" | "permissive";
      policies: readonly string[];
    },
    options?: { cause?: unknown }
  ) {
    const { table, command, as, policies } = details;
    const names = policies.map((name) => `"${name}"`).join(", ");
    const reason =
      as === "restrictive"
        ? `restrictive policy ${names} failed`
        : policies.length === 0
          ? `no permissive policy applies to ${command}`
          : `no permissive policy passed (${names})`;

    super(`Row policy refused the ${command} on "${table}": ${reason}.`, options);

    this.name = "PolicyViolationError";
    this.table = table;
    this.command = command;
    this.as = as;
    this.policies = Object.freeze([...policies]);
  }

  /**
   * The policy violation a driver error carries, or `undefined` when it is some other error. It
   * reads the message alone, so a session that drops the error's `code` still decodes it.
   */
  static fromDriverError(error: unknown, command: string): PolicyViolationError | undefined {
    const message = (error as { message?: unknown } | null)?.message;

    if (typeof message !== "string") {
      return undefined;
    }

    const match = MARKER_PATTERN.exec(message);

    if (!match) {
      return undefined;
    }

    const [, table = "", as, names = ""] = match;

    return new PolicyViolationError(
      {
        table,
        command,
        as: as as "restrictive" | "permissive",
        policies: names === "" ? [] : names.split(","),
      },
      { cause: error }
    );
  }
}
