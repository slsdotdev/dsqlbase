import type { SQLNode } from "../sql/nodes.js";
import type { PolicyCommand, PolicyConfig, PolicyFor } from "../resolvers/policy.js";

const COMMANDS: readonly PolicyCommand[] = ["select", "insert", "update", "delete"];

/** A policy resolved against a table's runtime columns. */
export type RuntimePolicy = {
  readonly name: string;
  readonly as: "permissive" | "restrictive";
  readonly commands: readonly PolicyCommand[];
  /** Filters the rows a select, update or delete sees. */
  readonly using?: SQLNode;
  /** What a written row must satisfy: the declared `check`, else `using`. */
  readonly check?: SQLNode;
};

/** The policies that apply to one command, split the way they compose. */
export type CommandPolicies = {
  readonly permissive: readonly RuntimePolicy[];
  readonly restrictive: readonly RuntimePolicy[];
};

/**
 * Resolves one declared policy, refusing what `CREATE POLICY` would: `using` on a policy only
 * for insert (there is no existing row), `check` on one only for select / delete (nothing is
 * written). It also requires what enforcement reads — `using` for any select, update or delete,
 * a check (declared, or `using`) for any insert or update — so a policy never silently means
 * "every row".
 */
export function resolvePolicy(table: string, name: string, config: PolicyConfig): RuntimePolicy {
  const declared: readonly PolicyFor[] =
    config.for === undefined ? ["all"] : typeof config.for === "string" ? [config.for] : config.for;

  if (declared.length === 0) {
    throw new Error(`Policy "${name}" on "${table}" applies to no command: \`for\` is empty.`);
  }

  const commands = declared.includes("all")
    ? COMMANDS
    : COMMANDS.filter((command) => declared.includes(command));

  const reads = commands.some((command) => command !== "insert");
  const writes = commands.some((command) => command === "insert" || command === "update");
  const label = `Policy "${name}" on "${table}" (for ${commands.join(", ")})`;

  if (config.using && !reads) {
    throw new Error(
      `${label} declares \`using\`, which an insert has no existing row to apply to.`
    );
  }

  if (config.check && !writes) {
    throw new Error(`${label} declares \`check\`, which only an insert or update applies.`);
  }

  if (reads && !config.using) {
    throw new Error(`${label} needs \`using\`: it decides which existing rows are visible.`);
  }

  if (writes && !config.check && !config.using) {
    throw new Error(`${label} needs \`check\`: it decides which rows may be written.`);
  }

  return Object.freeze({
    name,
    as: config.as ?? "permissive",
    commands: Object.freeze([...commands]),
    using: config.using,
    check: writes ? (config.check ?? config.using) : undefined,
  });
}

/** Groups resolved policies by the command they apply to, in declaration order. */
export function groupPolicies(
  policies: readonly RuntimePolicy[]
): ReadonlyMap<PolicyCommand, CommandPolicies> {
  const byCommand = new Map<PolicyCommand, CommandPolicies>();

  for (const command of COMMANDS) {
    const applying = policies.filter((policy) => policy.commands.includes(command));

    byCommand.set(
      command,
      Object.freeze({
        permissive: Object.freeze(applying.filter((policy) => policy.as === "permissive")),
        restrictive: Object.freeze(applying.filter((policy) => policy.as === "restrictive")),
      })
    );
  }

  return byCommand;
}
