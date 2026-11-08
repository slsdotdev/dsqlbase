import type { SQLNode } from "../sql/nodes.js";
import type { PolicyCommand, PolicyFor } from "../resolvers/policy.js";
import { AnyTable } from "./table.js";
import { AnyPolicyDefinition } from "../definition/policy.js";

const COMMANDS: PolicyCommand[] = ["select", "insert", "update", "delete"];

/** A policy resolved against a table's runtime columns. */
export type RuntimePolicyConfig<TTable extends AnyTable> = {
  readonly name: string;
  readonly as: "permissive" | "restrictive";
  readonly commands: PolicyCommand[];
  /** Filters the rows a select, update or delete sees. */
  readonly using?: SQLNode | ((columns: TTable["columns"]) => SQLNode);
  /** What a written row must satisfy: the declared `check`, else `using`. */
  readonly check?: SQLNode | ((columns: TTable["columns"]) => SQLNode);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPolicy = Policy<any, any>;

export class Policy<TTable extends AnyTable, TConfig extends RuntimePolicyConfig<TTable>> {
  readonly table: TTable;
  readonly as: "permissive" | "restrictive";
  readonly name: string;
  readonly commands: PolicyCommand[];

  private _check?: SQLNode | ((columns: TTable["columns"]) => SQLNode);
  private _using?: SQLNode | ((columns: TTable["columns"]) => SQLNode);

  constructor(table: TTable, config: TConfig) {
    this.name = config.name;
    this.table = table;
    this.commands = config.commands;
    this.as = config.as;
    this._using = config.using;
    this._check = config.check;
  }

  get using(): SQLNode | undefined {
    if (typeof this._using === "function") {
      return this._using(this.table.columns);
    }

    return this._using;
  }

  get check(): SQLNode | undefined {
    if (typeof this._check === "function") {
      return this._check(this.table.columns);
    }

    return this._check;
  }
}

/**
 * Resolves one declared policy, refusing what `CREATE POLICY` would: `using` on a policy only
 * for insert (there is no existing row), `check` on one only for select / delete (nothing is
 * written). It also requires what enforcement reads — `using` for any select, update or delete,
 * a check (declared, or `using`) for any insert or update — so a policy never silently means
 * "every row".
 */
export function resolvePolicy<TTable extends AnyTable>(
  table: TTable,
  definition: AnyPolicyDefinition
): Policy<TTable, RuntimePolicyConfig<TTable>> {
  const declared: readonly PolicyFor[] =
    definition["_for"] === undefined
      ? ["all"]
      : typeof definition["_for"] === "string"
        ? [definition["_for"]]
        : definition["_for"];

  if (declared.length === 0) {
    throw new Error(
      `Policy "${definition.name}" on "${table.name}" applies to no command: \`for\` is empty.`
    );
  }

  const commands = declared.includes("all")
    ? COMMANDS
    : COMMANDS.filter((command) => declared.includes(command));

  const reads = commands.some((command) => command !== "insert");
  const writes = commands.some((command) => command === "insert" || command === "update");
  const label = `Policy "${definition.name}" on "${table}" (for ${commands.join(", ")})`;

  if (definition["_using"] && !reads) {
    throw new Error(
      `${label} declares \`using\`, which an insert has no existing row to apply to.`
    );
  }

  if (definition["_check"] && !writes) {
    throw new Error(`${label} declares \`check\`, which only an insert or update applies.`);
  }

  if (reads && !definition["_using"]) {
    throw new Error(`${label} needs \`using\`: it decides which existing rows are visible.`);
  }

  if (writes && !definition["_check"] && !definition["_using"]) {
    throw new Error(`${label} needs \`check\`: it decides which rows may be written.`);
  }

  return new Policy(table, {
    name: definition.name,
    commands,
    as: definition["_as"] ?? "permissive",
    using: definition["_using"],
    check: writes ? (definition["_check"] ?? definition["_using"]) : undefined,
  });
}
