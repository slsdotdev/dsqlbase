import {
  AnyColumn,
  AnyColumnDefinition,
  AnyFieldRelation,
  AnyTable,
  AnyTableDefinition,
  ColumnCodec,
  DefinitionSchema,
  SchemaRegistry,
  TableDefinition,
  UnionDefinition,
} from "@dsqlbase/core";
import { AnyUnionColumnDefinition, columnEntries } from "@dsqlbase/core/definition";
import { GuidColumnDefinition } from "../schema/columns/guid.js";
import {
  GlobalIdError,
  decodeGlobalId,
  encodeGlobalId,
  isGlobalId,
} from "../schema/utils/global-id.js";

/**
 * Stamped on every runtime column declared with `guid()`, carrying what its values need in
 * order to name a row.
 *
 * A `Column` copies a fixed set of fields off its definition and the guid marker is not one of
 * them — global ids are a client concern, and `@dsqlbase/core` has no opinion about the shape
 * of an id. So the client marks the columns itself, once, when it builds the registry.
 */
export const GUID_BINDING: unique symbol = Symbol.for("dsqlbase.guid.binding");

export type GuidBinding = {
  /** The node this column's values name. */
  readonly key: string;

  /** The field the target node's primary key is addressed by (`id`, `membershipId`, …). */
  readonly keyField: string;
};

/**
 * Stamped on a keyless `guid()` column that is the `from` side of a belongs-to a union: its node
 * key is not fixed but read, row by row, from the relation's discriminator.
 */
export const DYNAMIC_GUID_BINDING: unique symbol = Symbol.for("dsqlbase.guid.dynamic");

export type DynamicGuidBinding = {
  /** The source column holding the member alias — the node key — of each row. */
  readonly discriminator: AnyColumn;

  /** The discriminator's field name, as `create` / `update` data names it. */
  readonly discriminatorField: string;

  /** Member alias → the field its key is addressed by in a payload (`id`, …). */
  readonly members: Readonly<Record<string, string>>;
};

/** A table addressable by global id: one whose primary key is exactly one `guid()` column. */
export type NodeTable = {
  /** The node key ids carry — the table's schema alias, unless its key column overrode it. */
  readonly key: string;

  /** The key the client addresses this table by (`dsql.members`). */
  readonly alias: string;

  readonly table: AnyTable;

  /** The field name of the primary key (`id`), as the payload names it. */
  readonly keyField: string;

  readonly keyColumn: AnyColumn;
};

/**
 * Node tables per registry rather than per client.
 *
 * A transaction client and an identity client are derived from their parent's
 * `ExecutionContext`, so they share one `SchemaRegistry` — keying off it is what makes
 * `$findByGlobalId` work the same on all three without threading anything through.
 */
const NODES = new WeakMap<SchemaRegistry<DefinitionSchema>, Map<string, NodeTable>>();

/** A guid column found in the schema, before its target has been resolved. */
type GuidColumn = {
  readonly table: AnyTable;
  readonly field: string;
  readonly column: AnyColumn;
  /** The declaration, kept only to key relation pairs by identity. */
  readonly definition: object;
  readonly key: string;
};

export function getGuidBinding(column: AnyColumn): GuidBinding | undefined {
  return (column as unknown as Record<symbol, GuidBinding | undefined>)[GUID_BINDING];
}

export function getDynamicGuidBinding(column: AnyColumn): DynamicGuidBinding | undefined {
  return (column as unknown as Record<symbol, DynamicGuidBinding | undefined>)[
    DYNAMIC_GUID_BINDING
  ];
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
  const dynamic = collectDynamicColumns(registry, schema);
  const guidColumns = collectGuidColumns(registry, schema, dynamic);
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

    const binding: GuidBinding = { key: node.key, keyField: node.keyField };

    setGuidBinding(guidColumn.column, binding);
    bindGuidCodec(guidColumn.column, binding);
  }

  for (const { column, binding } of dynamic.values()) {
    for (const [member, keyField] of Object.entries(binding.members)) {
      if (nodes.get(member)?.keyField !== keyField) {
        throw new Error(
          `Column "${column.table.alias}.${column.name}" reads its node from a discriminator, ` +
            `but union member "${member}" is not a node keyed by "${keyField}". Every member a ` +
            `polymorphic guid() can name must be a node, related through its own key.`
        );
      }
    }

    bindDynamicGuid(column, binding);
  }

  validateRelationPairs(registry, new Map(guidColumns.map((c) => [c.definition, c.key])), dynamic);

  NODES.set(registry, nodes);

  return nodes;
}

/**
 * Refuses a relation that pairs a guid column with something it cannot agree with.
 *
 * `article.authorId === article.author.id` is the promise a keyed guid column makes, and it
 * only holds if both sides of every pair wrap with the same node. A guid paired with a plain
 * uuid leaves one side wrapped and the other raw; two guids with different keys produce two
 * different strings for one row. Neither breaks the SQL — a join correlates on raw columns —
 * which is exactly why it has to be caught when the client is built rather than in production.
 */
function validateRelationPairs(
  registry: SchemaRegistry<DefinitionSchema>,
  keys: Map<object, string>,
  dynamic: Map<object, DynamicColumn>
): void {
  for (const [alias] of registry.getTableEntries()) {
    if (!registry.hasRelations(alias)) {
      continue;
    }

    const relations = registry.getRelations(alias) as Record<string, AnyFieldRelation>;

    for (const [field, relation] of Object.entries(relations)) {
      const label = `Relation "${field}" on table "${alias}"`;

      for (const [target, to, member] of targetColumnLists(relation)) {
        for (const [index, fromColumn] of relation.from.entries()) {
          const toColumn = to[index];

          if (!toColumn) {
            continue;
          }

          // A polymorphic column names whichever member its discriminator says, so it agrees
          // with any member — and with nothing that is not one.
          const fromDynamic = dynamic.get(fromColumn);
          const toDynamic = dynamic.get(toColumn);
          const fromKey = fromDynamic ? (member ?? POLYMORPHIC) : keys.get(fromColumn);
          const toKey = toDynamic ? agreeWith(toDynamic, fromKey) : keys.get(toColumn);

          if (fromKey === undefined && toKey === undefined) {
            continue;
          }

          const pair = `"${alias}.${fromColumn.name}" and "${target}.${toColumn.name}"`;

          if (fromKey === undefined || toKey === undefined) {
            throw new Error(
              `${label} pairs ${pair}, but only one of them carries global ids. ` +
                `Both sides of a pair must be guid() columns, or neither.`
            );
          }

          if (fromKey !== toKey) {
            throw new Error(
              `${label} pairs ${pair}, which carry global ids for "${fromKey}" and "${toKey}". ` +
                `Both sides of a pair must name the same node.`
            );
          }
        }
      }
    }
  }
}

/**
 * A relation's `to` side as one column list per target table: the table itself, or every
 * member of a union target — through a shared field or a per-member list.
 */
function targetColumnLists(
  relation: AnyFieldRelation
): [target: string, to: AnyColumnDefinition[], member?: string][] {
  const { target, to } = relation;

  if (!(target instanceof UnionDefinition)) {
    return [[target.name, to as AnyColumnDefinition[]]];
  }

  return Object.entries<AnyTableDefinition>(target.members).map(([alias, member]) => [
    member.name,
    Array.isArray(to)
      ? (to as AnyUnionColumnDefinition[]).map((column) => column.members[alias])
      : (to as Record<string, AnyColumnDefinition[]>)[alias],
    alias,
  ]);
}

/** How a polymorphic column is named in a pair error when no single node fits. */
const POLYMORPHIC = "(any member, per its discriminator)";

/** The key a polymorphic `to` column agrees on with `fromKey`: that key when it is a member. */
function agreeWith(column: DynamicColumn, fromKey: string | undefined): string {
  return fromKey !== undefined && Object.hasOwn(column.binding.members, fromKey)
    ? fromKey
    : POLYMORPHIC;
}

/** A keyless `guid()` found on the `from` side of a belongs-to a union. */
type DynamicColumn = {
  readonly column: AnyColumn;
  readonly binding: DynamicGuidBinding;
};

/**
 * Finds every `guid()` column whose node is named per row by a discriminator — the `from` side of
 * a belongs-to a union — keyed by its declaration.
 *
 * Such a column must be declared keyless: a static key would say "always this node" while the
 * discriminator says "whichever member this row names", and only one of them can be true.
 */
function collectDynamicColumns(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema
): Map<object, DynamicColumn> {
  const dynamic = new Map<object, DynamicColumn>();

  for (const [alias, node] of Object.entries(schema)) {
    if (!(node instanceof TableDefinition) || !registry.hasRelations(alias)) {
      continue;
    }

    const table = registry.getTable(alias);
    const relations = registry.getRelations(alias) as Record<string, AnyFieldRelation>;

    for (const [field, relation] of Object.entries(relations)) {
      const discriminator = registry.getRelationDiscriminator(alias, field);

      if (!discriminator) {
        continue;
      }

      const pairs = registry.getUnionRelationColumns(alias, field);
      const discriminatorField = fieldOf(table, discriminator);

      for (const [index, definition] of relation.from.entries()) {
        if (!(definition instanceof GuidColumnDefinition)) {
          continue;
        }

        const label = `Column "${alias}.${fieldOf(table, table.getColumn(definition.name) as AnyColumn)}"`;

        if (definition["_guidKey"] !== undefined) {
          throw new Error(
            `${label} names node "${definition["_guidKey"] as string}", but relation "${field}" ` +
              `reads its node from discriminator "${discriminatorField}". Declare it keyless — ` +
              `guid("${definition.name}") — so the discriminator decides.`
          );
        }

        if (dynamic.has(definition)) {
          throw new Error(
            `${label} is the polymorphic side of two relations; a discriminated guid() can ` +
              `belong to only one.`
          );
        }

        const members = Object.fromEntries(
          Object.entries(pairs).map(([member, to]) => [
            member,
            fieldOf(registry.getTable(member), to[index]),
          ])
        );

        dynamic.set(definition, {
          column: table.getColumn(definition.name) as AnyColumn,
          binding: { discriminator, discriminatorField, members },
        });
      }
    }
  }

  return dynamic;
}

/** The field a runtime column is declared under on its table. */
function fieldOf(table: AnyTable, column: AnyColumn): string {
  const entry = table.getColumnEntries().find(([, candidate]) => candidate === column);

  return entry?.[0] ?? column.name;
}

/**
 * Binds a polymorphic guid column: reads wrap with the node its row's discriminator names, and
 * writes and filters accept an id for any member, down to the raw key.
 *
 * Reading needs the discriminator, which the codec never sees — it decodes one value — so the
 * wrap is a row decoder instead, which core projects the discriminator for. A row whose
 * discriminator is `NULL`, or names no member, reads its id raw.
 */
function bindDynamicGuid(column: AnyColumn, binding: DynamicGuidBinding): void {
  const base = column.codec as ColumnCodec<unknown, unknown>;
  const { discriminator, members } = binding;

  Object.defineProperty(column, DYNAMIC_GUID_BINDING, {
    value: binding,
    enumerable: false,
    writable: false,
    configurable: true,
  });

  Object.defineProperty(column, "codec", {
    value: {
      decode: base.decode,
      encode: (value: unknown) => base.encode(unwrapMember(value, members)),
    } satisfies ColumnCodec<unknown, unknown>,
    enumerable: true,
    writable: false,
    configurable: true,
  });

  Object.defineProperty(column, "rowDecoder", {
    value: {
      dependsOn: [discriminator],
      decode: (raw: unknown, row: Record<string, unknown>) => {
        const key = row[discriminator.name];
        const value = base.decode(raw);

        if (typeof key !== "string" || !Object.hasOwn(members, key)) {
          return value;
        }

        return encodeGlobalId(key, { [members[key]]: value as string });
      },
    },
    enumerable: false,
    writable: false,
    configurable: true,
  });
}

/**
 * The member a wrapped id names, checked against the union: its key must be a member, and its
 * payload must carry that member's key field. `undefined` for a value that is not a global id.
 */
export function decodeMemberId(
  value: unknown,
  members: Readonly<Record<string, string>>
): { key: string; value: string } | undefined {
  if (!isGlobalId(value)) {
    return undefined;
  }

  const { key, pk } = decodeGlobalId(value);
  const keyField = members[key];

  if (keyField === undefined) {
    throw new GlobalIdError(
      "key_mismatch",
      `Global id for "${key}" cannot be stored here: this column holds ids for ` +
        `${Object.keys(members).map((member) => `"${member}"`).join(", ")}.`
    );
  }

  if (!Object.hasOwn(pk, keyField)) {
    throw new GlobalIdError(
      "key_mismatch",
      `Global id for "${key}" carries ${Object.keys(pk)
        .map((field) => `"${field}"`)
        .join(", ")} rather than its key "${keyField}".`
    );
  }

  return { key, value: pk[keyField] };
}

function unwrapMember(value: unknown, members: Readonly<Record<string, string>>): unknown {
  return decodeMemberId(value, members)?.value ?? value;
}

/**
 * Replaces a guid column's codec with one that wraps on the way out and unwraps on the way in.
 *
 * `Column` funnels every direction through this one object — `resolve` decodes a row value,
 * `getInsertValue` / `getUpdateValue` encode a written one, and `param` encodes a filter value —
 * so swapping it here covers reads, writes and `where` without touching the pipeline.
 *
 * Written onto the built column rather than onto the definition. The definition is the user's
 * object and may be shared by two clients; a binding depends on the alias it was exported
 * under, so binding there would let one client silently re-key the other's ids.
 */
function bindGuidCodec(column: AnyColumn, binding: GuidBinding): void {
  const { key, keyField } = binding;
  const base = column.codec as ColumnCodec<unknown, unknown>;

  const codec: ColumnCodec<unknown, unknown> = {
    decode: (raw) => encodeGlobalId(key, { [keyField]: base.decode(raw) as string }),
    encode: (value) => base.encode(unwrap(value, key, keyField)),
  };

  // `codec` is declared readonly on `Column`, which is a compile-time rule; the property
  // itself is an ordinary own property. Same escape hatch as the `column["_tenantKey"]`
  // writes in `tenantScope().columns()`.
  Object.defineProperty(column, "codec", {
    value: codec,
    enumerable: true,
    writable: false,
    configurable: true,
  });
}

/**
 * Reads a written or filtered value back down to what the column stores.
 *
 * Lenient by design: a raw uuid is accepted, because ids reach an application from places
 * that never went through the ORM. A *wrapped* id, though, is checked — that is the whole
 * point of carrying the table in the value. `decodeGlobalId` catches the wrong table; the
 * field check below catches a payload that names the right table but the wrong key.
 */
function unwrap(value: unknown, key: string, keyField: string): unknown {
  if (!isGlobalId(value)) {
    return value;
  }

  const { pk } = decodeGlobalId(value, key);

  if (!Object.hasOwn(pk, keyField)) {
    throw new GlobalIdError(
      "key_mismatch",
      `Global id for "${key}" carries ${Object.keys(pk)
        .map((field) => `"${field}"`)
        .join(", ")} rather than its key "${keyField}".`
    );
  }

  return pk[keyField];
}

function collectGuidColumns(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema,
  dynamic: Map<object, DynamicColumn>
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
    // A column group's members are walked too, by field path: a `guid()` member carries ids
    // like any other column, and is reached through its group on both sides.
    const columns = new Map(
      table.getLeafEntries().map(([path, column]) => [path.join("."), column])
    );

    for (const [path, definition] of columnEntries(node.columns)) {
      // A polymorphic column has no fixed node; it is bound separately.
      if (!(definition instanceof GuidColumnDefinition) || dynamic.has(definition)) {
        continue;
      }

      const field = path.join(".");
      const column = columns.get(field);

      if (!column) {
        continue;
      }

      guidColumns.push({
        table,
        field,
        column,
        definition,
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
