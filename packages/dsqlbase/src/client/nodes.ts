import {
  AnyColumn,
  AnyTable,
  DefinitionSchema,
  SchemaRegistry,
  TableDefinition,
} from "@dsqlbase/core";
import { GuidColumnDefinition } from "../schema/columns/guid.js";

/**
 * Stamped on every runtime column declared with `guid()`, carrying what its values need in
 * order to name a row.
 *
 * A `Column` copies a fixed set of fields off its definition and the guid marker is not one of
 * them — global ids are a client concern, and `@dsqlbase/core` has no opinion about the shape
 * of an id. So the client marks the columns itself, once, when it builds the registry.
 */
export const GUID_BINDING: unique symbol = Symbol.for("dsqlbase.guid.binding");

export interface GuidBinding {
  /** The node this column's values name. */
  readonly key: string;

  /** The field the target node's primary key is addressed by (`id`, `membershipId`, …). */
  readonly keyField: string;
}

/** A table addressable by global id: one whose primary key is exactly one `guid()` column. */
export interface NodeTable {
  /** The node key ids carry — the table's schema alias, unless its key column overrode it. */
  readonly key: string;

  /** The key the client addresses this table by (`dsql.members`). */
  readonly alias: string;

  readonly table: AnyTable;

  /** The field name of the primary key (`id`), as the payload names it. */
  readonly keyField: string;

  readonly keyColumn: AnyColumn;
}

/**
 * Node tables per registry rather than per client.
 *
 * A transaction client and an identity client are derived from their parent's
 * `ExecutionContext`, so they share one `SchemaRegistry` — keying off it is what makes
 * `$findByGlobalId` work the same on all three without threading anything through.
 */
const NODES = new WeakMap<SchemaRegistry<DefinitionSchema>, Map<string, NodeTable>>();

/** A guid column found in the schema, before its target has been resolved. */
interface GuidColumn {
  readonly table: AnyTable;
  readonly field: string;
  readonly column: AnyColumn;
  readonly key: string;
}

export function getGuidBinding(column: AnyColumn): GuidBinding | undefined {
  return (column as unknown as Record<symbol, GuidBinding | undefined>)[GUID_BINDING];
}

function setGuidBinding(column: AnyColumn, binding: GuidBinding): void {
  Object.defineProperty(column, GUID_BINDING, {
    value: binding,
    enumerable: false,
    writable: false,
    configurable: true,
  });
}

/** The node tables of a registry, empty for one that was never registered. */
export function getNodes(registry: SchemaRegistry<DefinitionSchema>): Map<string, NodeTable> {
  return NODES.get(registry) ?? new Map();
}

/**
 * Resolves every `guid()` column in a schema against the tables it can reach, and marks it.
 *
 * Runs once, when the client is built, because this is the first point at which the whole
 * schema exists: a column that references another table needs that table's key *field* name,
 * and a column that is its own table's key needs the alias it is exported under. Neither is
 * knowable where the column is declared.
 */
export function registerNodes(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema
): Map<string, NodeTable> {
  const guidColumns = collectGuidColumns(registry, schema);
  const nodes = collectNodes(guidColumns);

  for (const guidColumn of guidColumns) {
    const node = nodes.get(guidColumn.key);

    if (!node) {
      throw new Error(
        `Column "${guidColumn.table.alias}.${guidColumn.field}" carries global ids for "${guidColumn.key}", ` +
          `which is not a node in this schema. A node is a table whose primary key is exactly one guid() column` +
          (nodes.size > 0
            ? `; this schema has ${[...nodes.keys()].map((key) => `"${key}"`).join(", ")}.`
            : ".")
      );
    }

    setGuidBinding(guidColumn.column, { key: node.key, keyField: node.keyField });
  }

  NODES.set(registry, nodes);

  return nodes;
}

function collectGuidColumns(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema
): GuidColumn[] {
  const guidColumns: GuidColumn[] = [];

  // Walked over the *definitions* rather than the registry's tables, because `guid()` is a
  // subclass of `ColumnDefinition` and nothing about it survives into the runtime column. The
  // definition object's keys are the aliases, which is also what a node key defaults to.
  for (const [alias, node] of Object.entries(schema)) {
    if (!(node instanceof TableDefinition)) {
      continue;
    }

    const table = registry.getTable(alias);

    for (const [field, definition] of Object.entries(node.columns)) {
      if (!(definition instanceof GuidColumnDefinition)) {
        continue;
      }

      const column = table.getColumn(field);

      if (!column) {
        continue;
      }

      guidColumns.push({
        table,
        field,
        column,
        key: (definition["_guidKey"] as string | undefined) ?? alias,
      });
    }
  }

  return guidColumns;
}

function collectNodes(guidColumns: GuidColumn[]): Map<string, NodeTable> {
  const nodes = new Map<string, NodeTable>();

  for (const guidColumn of guidColumns) {
    const { table, field, column, key } = guidColumn;

    // A node is addressed by a single value, so a composite key cannot be one: `guid()` has no
    // way to declare the other half. Such a table is simply not a node, and a column pointing
    // at it fails the "not a node in this schema" check above.
    if (table.primaryKey.length !== 1 || table.primaryKey[0] !== column) {
      continue;
    }

    const existing = nodes.get(key);

    if (existing) {
      throw new Error(
        `Tables "${existing.alias}" and "${table.alias}" both claim the node key "${key}". ` +
          `A global id names exactly one table, so two nodes cannot share a key; pass a distinct ` +
          `key to guid() on one of them.`
      );
    }

    nodes.set(key, { key, alias: table.alias, table, keyField: field, keyColumn: column });
  }

  return nodes;
}
