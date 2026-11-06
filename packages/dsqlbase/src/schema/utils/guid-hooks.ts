import {
  AnyColumn,
  AnyTable,
  ColumnHookContext,
  ColumnHooks,
  ComputedDiscriminator,
  ReferenceEnd,
} from "@dsqlbase/core";
import { GlobalIdError, decodeGlobalId, encodeGlobalId, isGlobalId } from "./global-id.js";

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

/**
 * The hooks every `guid()` column carries: a read wraps the raw uuid as a global id, a write or
 * a filter unwraps one. What an id names comes from the column's references, read when the hook
 * first runs — they are linked and frozen by then — and kept per built column.
 *
 * One object for every guid column, which is what lets `validateSchema` require both sides of a
 * relation pair to carry it, and refuse a guid column referencing two targets.
 */
export const guidHooks: ColumnHooks<string> = {
  read(value: string, { column, row }: ColumnHookContext): string {
    const binding = bindingOf(column);

    if ("key" in binding) {
      return encodeGlobalId(binding.key, { [binding.keyField]: value });
    }

    // A NULL discriminator, or one naming no member, reads the id raw.
    const member = row?.[binding.discriminator.name];

    return typeof member === "string" && Object.hasOwn(binding.members, member)
      ? encodeGlobalId(member, { [binding.members[member]]: value })
      : value;
  },

  write(value: string, { column }: ColumnHookContext): string {
    const binding = bindingOf(column);

    return "key" in binding
      ? unwrap(value, binding.key, binding.keyField)
      : (decodeMemberId(value, binding.members)?.value ?? value);
  },
};

/** The binding of a `guid()` column; `undefined` for a column that names one node per row, or is no guid. */
export function getGuidBinding(column: AnyColumn): GuidBinding | undefined {
  if (column.hooks !== guidHooks) {
    return undefined;
  }

  const binding = bindingOf(column);
  return "key" in binding ? binding : undefined;
}

/** The binding of a `guid()` column that names its node per row; `undefined` otherwise. */
export function getDynamicGuidBinding(column: AnyColumn): DynamicGuidBinding | undefined {
  if (column.hooks !== guidHooks) {
    return undefined;
  }

  const binding = bindingOf(column);
  return "discriminator" in binding ? binding : undefined;
}

/**
 * Bindings per built column. A built column belongs to one registry, so a binding — which
 * depends on the alias a table is exported under — never leaks into another client over the
 * same schema.
 */
const BINDINGS = new WeakMap<AnyColumn, GuidBinding | DynamicGuidBinding>();

function bindingOf(column: AnyColumn): GuidBinding | DynamicGuidBinding {
  let binding = BINDINGS.get(column);

  if (!binding) {
    binding = resolveBinding(column);
    BINDINGS.set(column, binding);
  }

  return binding;
}

/**
 * What a guid column's ids name, from where its references end:
 *
 * - no reference: its own table and field — a primary key, or a column no relation points
 *   through;
 * - a chain of table references: the column it ends at — `articles.authorId` reads as an
 *   authors id through `articles.author`;
 * - a union reference: the member its row's discriminator names.
 *
 * `validateSchema` has refused every other shape — two targets, a ring, a member reached
 * through no unique key — so the first end found is the only one.
 */
function resolveBinding(column: AnyColumn): GuidBinding | DynamicGuidBinding {
  const { ends } = column.resolveReferences();
  const end: ReferenceEnd | undefined =
    ends.find((candidate) => candidate.kind === "union") ?? ends[0];

  if (!end || (end.kind === "table" && end.column === column)) {
    return { key: column.table.alias, keyField: fieldOf(column.table, column) };
  }

  if (end.kind === "table") {
    return { key: end.column.table.alias, keyField: fieldOf(end.column.table, end.column) };
  }

  const { discriminator, members } = end.reference;

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

/** The field a built column is declared under on its table. */
function fieldOf(table: AnyTable, column: AnyColumn): string {
  const entry = table.getColumnEntries().find(([, candidate]) => candidate === column);

  return entry?.[0] ?? column.name;
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

/**
 * Reads a written or filtered value back down to what the column stores.
 *
 * Lenient by design: a raw uuid is accepted, because ids reach an application from places
 * that never went through the ORM. A *wrapped* id, though, is checked — that is the whole
 * point of carrying the table in the value. `decodeGlobalId` catches the wrong table; the
 * field check below catches a payload that names the right table but the wrong key.
 */
function unwrap(value: string, key: string, keyField: string): string {
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
