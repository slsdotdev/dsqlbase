import type { SQLNode } from "../sql/nodes.js";
import type { AnyTable, TableColumns } from "../runtime/table.js";

/** A statement a policy applies to — PostgreSQL's `FOR` commands, `ALL` aside. */
export type PolicyCommand = "select" | "insert" | "update" | "delete";

/** What `for` accepts: one command, `"all"`, or several. */
export type PolicyFor = "all" | PolicyCommand;

/**
 * A row policy, shaped like `CREATE POLICY … AS … FOR … USING (…) WITH CHECK (…)`.
 *
 * - `as`: permissive policies for a command are OR-ed, restrictive ones AND-ed onto them.
 *   Default `"permissive"`.
 * - `for`: the commands it applies to. Default `"all"`. An array is one policy per command.
 * - `using`: which existing rows a select, update or delete may see. Rows it rejects are
 *   skipped silently.
 * - `check`: what a row written by an insert or update must satisfy; a write that fails it
 *   throws and writes nothing. Defaults to `using`.
 */
export type PolicyConfig = {
  readonly as?: "permissive" | "restrictive";
  readonly for?: PolicyFor | readonly PolicyFor[];
  readonly using?: SQLNode;
  readonly check?: SQLNode;
};

/**
 * Declares a policy against a table's runtime columns, so `${t.ownerId}` renders under whatever
 * alias the level reading it is bound to. Runs once, when the client is built.
 */
export type PolicyResolver<T extends AnyTable> = (columns: TableColumns<T>) => PolicyConfig;
