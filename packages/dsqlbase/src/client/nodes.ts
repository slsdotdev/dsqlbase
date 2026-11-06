import {
  AnyColumnDefinition,
  AnyTable,
  AnyTableDefinition,
  DefinitionSchema,
  SchemaRegistry,
  TableDefinition,
} from "@dsqlbase/core";
import { IndexColumnDefinition, UniqueConstraintDefinition } from "@dsqlbase/core/definition";

export type { GuidBinding, DynamicGuidBinding } from "../schema/utils/guid-hooks.js";

/** A table addressable by global id: one with at least one unique key. */
export type NodeTable = {
  /** The node key ids carry — the table's schema alias. */
  readonly key: string;

  /** The key the client addresses this table by (`dsql.members`). */
  readonly alias: string;

  readonly table: AnyTable;

  /**
   * Every field set that names at most one row — the primary key, then each unique column,
   * constraint and index — sorted, as a payload's fields are matched against them. An id
   * resolves only when its fields are exactly one of these.
   */
  readonly keys: readonly (readonly string[])[];
};

/**
 * Node tables per registry rather than per client.
 *
 * A transaction client and an identity client are derived from their parent's
 * `ExecutionContext`, so they share one `SchemaRegistry` — keying off it is what makes
 * `$findByGlobalId` work the same on all three without threading anything through.
 */
const NODES = new WeakMap<SchemaRegistry<DefinitionSchema>, Map<string, NodeTable>>();

/** The node tables of a registry, empty for one that was never registered. */
export function getNodes(registry: SchemaRegistry<DefinitionSchema>): Map<string, NodeTable> {
  return NODES.get(registry) ?? new Map();
}

/**
 * Discovers the node tables of a schema — the tables a global id can address — once, when the
 * client is built. What each guid column's ids name is not decided here: the column's hooks
 * read it from its references (`schema/utils/guid-hooks.ts`), and `validateSchema` has already
 * refused a guid column that could name two nodes.
 */
export function registerNodes(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema
): Map<string, NodeTable> {
  const nodes = collectNodes(registry, schema);

  NODES.set(registry, nodes);

  return nodes;
}

/**
 * The tables addressable by global id: every table with at least one unique key, keyed by alias.
 *
 * Uniqueness is what makes an id an address — a payload over a set of fields that is not a key
 * could name many rows. A partial unique index is not a key (it is unique only where its
 * predicate holds), and neither is one over an expression, which no payload field can name.
 */
function collectNodes(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema
): Map<string, NodeTable> {
  const nodes = new Map<string, NodeTable>();

  for (const [alias, node] of Object.entries(schema)) {
    if (!(node instanceof TableDefinition)) {
      continue;
    }

    const table = registry.getTable(alias);
    const keys = uniqueKeysOf(table, node);

    if (keys.length > 0) {
      nodes.set(alias, { key: alias, alias, table, keys });
    }
  }

  return nodes;
}

/** A table's unique keys as sorted field sets, the primary key first, without repeats. */
function uniqueKeysOf(table: AnyTable, definition: AnyTableDefinition): string[][] {
  // Constraints and indexes name database columns; a payload names fields.
  const fieldOf = new Map(table.getColumnEntries().map(([field, column]) => [column.name, field]));
  const keys = new Map<string, string[]>();

  const add = (fields: (string | undefined)[]) => {
    // A key over a deprecated column is not addressable: the client has no field for it.
    if (fields.length === 0 || fields.some((field) => field === undefined)) {
      return;
    }

    const key = [...new Set(fields as string[])].sort();
    keys.set(key.join("\u0000"), key);
  };

  add(table.primaryKey.map((column) => fieldOf.get(column.name)));

  for (const [field, column] of table.getColumnEntries()) {
    if (column.unique) add([field]);
  }

  for (const constraint of definition["_constraints"]) {
    if (constraint instanceof UniqueConstraintDefinition) {
      add(constraint["_columns"].map((ref: { name: string }) => fieldOf.get(ref.name)));
    }
  }

  for (const index of definition["_indexes"]) {
    const columns = index["_columns"];

    if (
      !index["_unique"] ||
      index["_where"] ||
      columns.some((c) => !(c instanceof IndexColumnDefinition))
    ) {
      continue;
    }

    add(
      columns.map((c) =>
        fieldOf.get((c as IndexColumnDefinition<string, AnyColumnDefinition>)["_column"].name)
      )
    );
  }

  return [...keys.values()];
}
