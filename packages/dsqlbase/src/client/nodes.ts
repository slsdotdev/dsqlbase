import {
  AnyColumn,
  AnyColumnDefinition,
  AnyTable,
  AnyTableDefinition,
  ColumnCodec,
  ColumnReference,
  ComputedDiscriminator,
  DefinitionSchema,
  ReferenceEnd,
  Relation,
  SchemaRegistry,
  TableDefinition,
  Union,
  UnionReference,
} from "@dsqlbase/core";
import { IndexColumnDefinition, UniqueConstraintDefinition } from "@dsqlbase/core/definition";
import { GuidColumnDefinition } from "../schema/columns/guid.js";
import {
  GlobalIdError,
  decodeGlobalId,
  encodeGlobalId,
  isGlobalId,
} from "../schema/utils/global-id.js";

/** What a `guid()` column's values name: one node, the same for every row. */
export type GuidBinding = {
  /** The node this column's values name. */
  readonly key: string;

  /** The field the target node's primary key is addressed by (`id`, `membershipId`, …). */
  readonly keyField: string;
};

/**
 * What a `guid()` column whose node is named per row names: a key pointing at a union's member
 * — the `from` of a belongs-to a union, or the foreign key of a relation whose source is one.
 * The discriminator names each row's member alias, which is the node key.
 */
export type DynamicGuidBinding = {
  /**
   * What names each row's member: a stored column, or a discriminator core computes when the
   * query runs, when the relation declares none. Either is read from the row by its `name`.
   */
  readonly discriminator: AnyColumn | ComputedDiscriminator;

  /**
   * The stored discriminator's field name, as `create` / `update` data names it; `undefined`
   * for a computed one, which there is nothing to write to.
   */
  readonly discriminatorField: string | undefined;

  /** Member alias → the field its key is addressed by in a payload (`id`, …). */
  readonly members: Readonly<Record<string, string>>;
};

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

/**
 * The binding of every guid column, keyed by the built column. Built columns belong to one
 * registry, so a binding — which depends on the alias a table is exported under — never leaks
 * into another client over the same schema.
 */
const BINDINGS = new WeakMap<AnyColumn, GuidBinding | DynamicGuidBinding>();

export function getGuidBinding(column: AnyColumn): GuidBinding | undefined {
  const binding = BINDINGS.get(column);
  return binding && "key" in binding ? binding : undefined;
}

export function getDynamicGuidBinding(column: AnyColumn): DynamicGuidBinding | undefined {
  const binding = BINDINGS.get(column);
  return binding && "discriminator" in binding ? binding : undefined;
}

/** The node tables of a registry, empty for one that was never registered. */
export function getNodes(registry: SchemaRegistry<DefinitionSchema>): Map<string, NodeTable> {
  return NODES.get(registry) ?? new Map();
}

/**
 * Binds every `guid()` column in a schema to what its ids name, read off the references core
 * sets on each foreign key while it builds relations.
 *
 * Runs once, when the client is built. Core knows what each column points at; what that means
 * for a global id — which node, which field, and which conflicts a guid cannot live with — is
 * decided here.
 */
export function registerNodes(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema
): Map<string, NodeTable> {
  const guidColumns = collectGuidColumns(registry, schema);
  const nodes = collectNodes(registry, schema);

  assertGuidPairs(registry, guidColumns);

  for (const column of guidColumns) {
    const binding = resolveBinding(column);

    BINDINGS.set(column, binding);

    if ("key" in binding) {
      bindGuidCodec(column, binding);
      continue;
    }

    for (const [member, keyField] of Object.entries(binding.members)) {
      const keys = nodes.get(member)?.keys ?? [];

      if (!keys.some((key) => key.length === 1 && key[0] === keyField)) {
        throw new Error(
          `Column "${label(column)}" reads its node from a discriminator, but "${keyField}" is ` +
            `not a unique key of union member "${member}". Every member a polymorphic guid() ` +
            `can name must be related through a unique key of its own.`
        );
      }
    }

    bindDynamicGuid(column, binding);
  }

  NODES.set(registry, nodes);

  return nodes;
}

/** How a column is named in an error: `"articles.authorId"`. */
function label(column: AnyColumn): string {
  return `${column.table.alias}.${fieldOf(column.table, column)}`;
}

/** How a reference's relation is named in an error: `relation "author" on table "articles"`. */
function describeVia(reference: ColumnReference): string {
  return `relation "${reference.via.field}" on ${describeOwner(reference.via.declaredOn)}`;
}

/** Where a relation was declared: `table "articles"`, or `union "posts"`. */
function describeOwner(owner: AnyTable | Union): string {
  return `${owner instanceof Union ? "union" : "table"} "${owner.alias}"`;
}

/** How a chain end is named in an error. */
function describeEnd(end: ReferenceEnd): string {
  if (end.kind === "table") {
    return `"${label(end.column)}"`;
  }

  const { union, discriminator } = end.reference;
  return discriminator instanceof ComputedDiscriminator
    ? `union "${union.alias}"`
    : `union "${union.alias}" (per "${label(discriminator)}")`;
}

/**
 * What a guid column's ids name, from where its references end.
 *
 * - No reference: the column ends at itself, so it names its own table and field — a primary
 *   key, or a column no relation points through.
 * - A chain of table references: the column it ends at — `articles.authorId` reads as an
 *   authors id through `articles.author`.
 * - A union reference: the member its row's discriminator names. A table reference that ends at
 *   one of that union's members agrees with it — a member's has-many onto the same column.
 *
 * Two chains ending at different columns, or at a column outside the union, are refused: a
 * guid() column names one node. So is a ring, which names none.
 */
function resolveBinding(column: AnyColumn): GuidBinding | DynamicGuidBinding {
  const { ring } = column.resolveReferences();

  if (ring) {
    throw new Error(
      `Columns ${ring.map((c) => `"${label(c)}"`).join(" → ")} reference each other in a ` +
        `ring, so none of them names a node. One side of a relation must be a key.`
    );
  }

  const candidates = column.references.flatMap((reference) =>
    endsOf(reference).map((end) => ({ via: describeVia(reference), end }))
  );

  if (candidates.length === 0) {
    return { key: column.table.alias, keyField: fieldOf(column.table, column) };
  }

  const unions = candidates.filter(
    (candidate): candidate is { via: string; end: { kind: "union"; reference: UnionReference } } =>
      candidate.end.kind === "union"
  );
  const [first] = unions.length > 0 ? unions : candidates;

  const agrees = (end: ReferenceEnd) => {
    if (first.end.kind === "union") {
      return end.kind === "union"
        ? end.reference === first.end.reference
        : Object.values(first.end.reference.members).includes(end.column);
    }

    return end.kind === "table" && end.column === first.end.column;
  };

  const conflict = candidates.find(({ end }) => !agrees(end));

  if (conflict) {
    throw new Error(
      `Column "${label(column)}" is paired by ${first.via} with ${describeEnd(first.end)} and ` +
        `by ${conflict.via} with ${describeEnd(conflict.end)}. A guid() column names one node.`
    );
  }

  if (first.end.kind === "table") {
    const end = first.end.column;
    return { key: end.table.alias, keyField: fieldOf(end.table, end) };
  }

  const { discriminator, members } = first.end.reference;

  return {
    discriminator,
    discriminatorField:
      discriminator instanceof ComputedDiscriminator
        ? undefined
        : fieldOf(discriminator.table, discriminator),
    members: Object.fromEntries(
      Object.entries(members).map(([member, target]) => [member, fieldOf(target.table, target)])
    ),
  };
}

/** Where one reference leads: the ends of its target's chain, or the union itself. */
function endsOf(reference: ColumnReference): ReferenceEnd[] {
  return reference.kind === "table"
    ? reference.column.resolveReferences().ends
    : [{ kind: "union", reference }];
}

/**
 * Refuses a relation that pairs a guid column with a plain one.
 *
 * `article.authorId === article.author.id` is the promise a guid column makes, and it only holds
 * if both sides of every pair wrap. A guid paired with a plain uuid leaves one side wrapped and
 * the other raw. Neither breaks the SQL — a join correlates on raw columns — which is exactly why
 * it has to be caught when the client is built rather than in production.
 *
 * Walks every column, not only guid ones: a plain-uuid foreign key referencing a guid key holds
 * the reference on its plain side.
 */
function assertGuidPairs(
  registry: SchemaRegistry<DefinitionSchema>,
  guidColumns: Set<AnyColumn>
): void {
  for (const [, table] of registry.getTableEntries()) {
    for (const [, column] of table.getColumnEntries()) {
      for (const reference of column.references) {
        const targets =
          reference.kind === "table" ? [reference.column] : Object.values(reference.members);

        for (const target of targets) {
          if (guidColumns.has(column) === guidColumns.has(target)) {
            continue;
          }

          // Named as the relation declares the pair: its `from` side first.
          const relation = reference.via;
          const [from, to] =
            relation.type === Relation.BELONGS_TO ? [column, target] : [target, column];

          throw new Error(
            `Relation "${relation.field}" on ${describeOwner(relation.declaredOn)} pairs ` +
              `"${from.table.alias}.${from.name}" and "${to.table.name}.${to.name}", but only ` +
              `one of them carries global ids. Both sides of a pair must be guid() columns, or ` +
              `neither.`
          );
        }
      }
    }
  }
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
 * wrap is a row decoder instead; core projects the discriminator, the column's dependency. A row whose
 * discriminator is `NULL`, or names no member, reads its id raw.
 */
function bindDynamicGuid(column: AnyColumn, binding: DynamicGuidBinding): void {
  const base = column.codec as ColumnCodec<unknown, unknown>;
  const { discriminator, members } = binding;

  Object.defineProperty(column, "codec", {
    value: {
      decode: base.decode,
      encode: (value: unknown) => base.encode(unwrapMember(value, members)),
    } satisfies ColumnCodec<unknown, unknown>,
    enumerable: true,
    writable: false,
    configurable: true,
  });

  // Core projects the discriminator with the column: it is the column's union reference.
  Object.defineProperty(column, "rowDecoder", {
    value: {
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
        `${Object.keys(members)
          .map((member) => `"${member}"`)
          .join(", ")}.`
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

/**
 * Every built column declared with `guid()`.
 *
 * Walked over the *definitions* rather than the registry's tables, because `guid()` is a
 * subclass of `ColumnDefinition` and nothing about it survives into the runtime column.
 */
function collectGuidColumns(
  registry: SchemaRegistry<DefinitionSchema>,
  schema: DefinitionSchema
): Set<AnyColumn> {
  const guidColumns = new Set<AnyColumn>();

  for (const [alias, node] of Object.entries(schema)) {
    if (!(node instanceof TableDefinition)) {
      continue;
    }

    const table = registry.getTable(alias);

    for (const [field, definition] of Object.entries(node.columns)) {
      const column = table.getColumn(field);

      if (definition instanceof GuidColumnDefinition && column) {
        guidColumns.add(column);
      }
    }
  }

  return guidColumns;
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
