import {
  AnyColumnDefinition,
  AnyTableDefinition,
  AnyUnionDefinition,
  AnyUniqueConstraintDefinition,
  IndexColumnDefinition,
  PrimaryKeyConstraintDefinition,
  Relation,
  UniqueConstraintDefinition,
  UnionDefinition,
} from "../definition/index.js";
import type { SourcedRelation } from "./validate.js";

/**
 * What a foreign-key column points at, read from definitions: the same references
 * `buildSchema` later sets on runtime columns (`linkReferences`), enough to check them.
 */
type Reference =
  | { readonly kind: "table"; readonly column: AnyColumnDefinition; readonly via: SourcedRelation }
  | {
      readonly kind: "union";
      readonly union: AnyUnionDefinition;
      /** Member alias → the member's column at this position. */
      readonly members: Readonly<Record<string, AnyColumnDefinition>>;
      /** The stored discriminator; `undefined` when it is computed. */
      readonly discriminator?: AnyColumnDefinition;
      readonly via: SourcedRelation;
    };

type UnionReference = Extract<Reference, { kind: "union" }>;

type End =
  | { readonly kind: "table"; readonly column: AnyColumnDefinition }
  | { readonly kind: "union"; readonly reference: UnionReference };

export type ReferenceIndex = {
  /** Table definition → the alias the schema exports it under. */
  readonly aliases: ReadonlyMap<AnyTableDefinition, string>;
  /** Union definition → its schema alias. */
  readonly unions: ReadonlyMap<AnyUnionDefinition, string>;
  /** Column definition → the table it is declared on. */
  readonly owners: ReadonlyMap<AnyColumnDefinition, AnyTableDefinition>;
};

/**
 * Checks what columns point at, across every relation:
 *
 * - no column's references lead back to it: a ring ends at no key, for any column;
 * - a column with hooks reads its value through what it references, so every chain from it ends
 *   at one column, or one union — a table end that is one of that union's members agrees with
 *   it — and each member of that union is reached through a single-column unique key, which is
 *   what the member's value can name.
 *
 * A plain column may point at two targets: a key can be a foreign key of two tables.
 */
export function validateReferences(
  relations: readonly SourcedRelation[],
  index: ReferenceIndex,
  memberColumns: (entry: SourcedRelation) => Record<string, AnyColumnDefinition[]>
): void {
  const references = collectReferences(relations, memberColumns);
  const label = (column: AnyColumnDefinition) => labelOf(column, index);

  for (const column of references.keys()) {
    const { ring } = resolveEnds(column, references);

    if (ring) {
      throw new Error(
        `Columns ${ring.map((c) => `"${label(c)}"`).join(" → ")} reference each other in a ` +
          `ring, so none of them ends at a key. One side of a relation must be a key.`
      );
    }
  }

  for (const column of references.keys()) {
    if (!column["_hooks"]) {
      continue;
    }

    const candidates = (references.get(column) ?? []).flatMap((reference) =>
      endsOf(reference, references).map((end) => ({ via: describeVia(reference, index), end }))
    );
    const unions = candidates.filter((candidate) => candidate.end.kind === "union");
    const [first] = unions.length > 0 ? unions : candidates;

    if (!first) {
      continue;
    }

    const conflict = candidates.find(({ end }) => !agrees(first.end, end));

    if (conflict) {
      throw new Error(
        `Column "${label(column)}" is paired by ${first.via} with ` +
          `${describeEnd(first.end, index)} and by ${conflict.via} with ` +
          `${describeEnd(conflict.end, index)}. A column with hooks — a guid(), say — reads ` +
          `its value through what it references, so it must reference one target.`
      );
    }

    if (first.end.kind !== "union") {
      continue;
    }

    for (const [member, target] of Object.entries(first.end.reference.members)) {
      const table = first.end.reference.union.members[member] as AnyTableDefinition;

      if (!isSingleColumnKey(table, target)) {
        throw new Error(
          `Column "${label(column)}" reads its member from a discriminator, but ` +
            `"${label(target)}" is not a unique key of union member "${member}". Every member ` +
            `a column with hooks — a polymorphic guid(), say — can name must be related ` +
            `through a unique key of its own.`
        );
      }
    }
  }
}

/** Every reference, on the foreign key, as `linkReferences` sets them. */
function collectReferences(
  relations: readonly SourcedRelation[],
  memberColumns: (entry: SourcedRelation) => Record<string, AnyColumnDefinition[]>
): Map<AnyColumnDefinition, Reference[]> {
  const references = new Map<AnyColumnDefinition, Reference[]>();

  const add = (column: AnyColumnDefinition, reference: Reference) => {
    // A pair of a column with itself says nothing about where it points.
    if (reference.kind === "table" && reference.column === column) {
      return;
    }

    const held = references.get(column) ?? [];

    if (!held.some((existing) => isSame(existing, reference))) {
      references.set(column, [...held, reference]);
    }
  };

  // A has-many / has-one declared on a union: one copy per member, gathered by field.
  const fromUnions = new Map<string, SourcedRelation[]>();

  for (const entry of relations) {
    const { relation } = entry;
    const belongsTo = relation.type === Relation.BELONGS_TO;
    const from = relation.from as AnyColumnDefinition[];

    if (relation.target instanceof UnionDefinition) {
      const union = relation.target;
      const lists = memberColumns(entry);

      for (const [position, column] of from.entries()) {
        if (belongsTo) {
          add(column, {
            kind: "union",
            union,
            members: Object.fromEntries(
              Object.entries(lists).map(([member, columns]) => [member, columns[position]])
            ),
            discriminator: relation.discriminator,
            via: entry,
          });
          continue;
        }

        for (const columns of Object.values(lists)) {
          add(columns[position], { kind: "table", column, via: entry });
        }
      }

      continue;
    }

    const to = relation.to as AnyColumnDefinition[];

    if (!belongsTo && entry.union) {
      const key = `${entry.union.name}\u0000${entry.field}`;
      fromUnions.set(key, [...(fromUnions.get(key) ?? []), entry]);
      continue;
    }

    for (const [position, column] of from.entries()) {
      if (belongsTo) {
        add(column, { kind: "table", column: to[position], via: entry });
      } else {
        add(to[position], { kind: "table", column, via: entry });
      }
    }
  }

  for (const copies of fromUnions.values()) {
    const [first] = copies;
    const union = first.union as AnyUnionDefinition;

    for (const [position, key] of (first.relation.to as AnyColumnDefinition[]).entries()) {
      add(key, {
        kind: "union",
        union,
        members: Object.fromEntries(
          copies.map((copy) => [
            copy.member,
            (copy.relation.from as AnyColumnDefinition[])[position],
          ])
        ),
        via: first,
      });
    }
  }

  return references;
}

/**
 * Two references are one when they point at the same column, or at the same union over the same
 * member columns — a computed discriminator is shared with a stored one over the same key, as
 * `linkReferences` does.
 */
function isSame(a: Reference, b: Reference): boolean {
  if (a.kind === "table" || b.kind === "table") {
    return a.kind === "table" && b.kind === "table" && a.column === b.column;
  }

  return (
    a.union === b.union &&
    Object.entries(a.members).every(([member, column]) => b.members[member] === column) &&
    (a.discriminator === b.discriminator || !a.discriminator || !b.discriminator)
  );
}

/** Where `column`'s chains end, and the first ring met on the way. */
function resolveEnds(
  column: AnyColumnDefinition,
  references: ReadonlyMap<AnyColumnDefinition, readonly Reference[]>
): { ends: End[]; ring?: AnyColumnDefinition[] } {
  const ends: End[] = [];
  let ring: AnyColumnDefinition[] | undefined;

  const walk = (current: AnyColumnDefinition, path: AnyColumnDefinition[]) => {
    if (path.includes(current)) {
      ring ??= [...path.slice(path.indexOf(current)), current];
      return;
    }

    const held = references.get(current) ?? [];

    if (held.length === 0) {
      ends.push({ kind: "table", column: current });
      return;
    }

    for (const reference of held) {
      if (reference.kind === "table") {
        walk(reference.column, [...path, current]);
      } else {
        ends.push({ kind: "union", reference });
      }
    }
  };

  walk(column, []);

  return ring ? { ends, ring } : { ends };
}

/** Where one reference leads: the ends of its target's chain, or the union itself. */
function endsOf(
  reference: Reference,
  references: ReadonlyMap<AnyColumnDefinition, readonly Reference[]>
): End[] {
  return reference.kind === "table"
    ? resolveEnds(reference.column, references).ends
    : [{ kind: "union", reference }];
}

/** Whether `end` names what `first` names; a member's column agrees with its union. */
function agrees(first: End, end: End): boolean {
  if (first.kind === "union") {
    return end.kind === "union"
      ? isSame(first.reference, end.reference)
      : Object.values(first.reference.members).includes(end.column);
  }

  return end.kind === "table" && end.column === first.column;
}

/**
 * Whether `column` alone names at most one row of `table`: it is the whole primary key, a
 * `.unique()` column, a one-column unique constraint, or a one-column unique index that is not
 * partial.
 */
function isSingleColumnKey(table: AnyTableDefinition, column: AnyColumnDefinition): boolean {
  if (column["_unique"]) {
    return true;
  }

  const flagged = Object.values<AnyColumnDefinition>(table.columns).filter(
    (candidate) => candidate["_primaryKey"]
  );

  if (flagged.length === 1 && flagged[0] === column) {
    return true;
  }

  for (const constraint of table["_constraints"]) {
    if (
      constraint instanceof PrimaryKeyConstraintDefinition ||
      constraint instanceof UniqueConstraintDefinition
    ) {
      const refs = (constraint as AnyUniqueConstraintDefinition)["_columns"] as { name: string }[];

      if (refs.length === 1 && refs[0].name === column.name) {
        return true;
      }
    }
  }

  for (const index of table["_indexes"]) {
    const [first, ...rest] = index["_columns"];

    if (
      index["_unique"] &&
      !index["_where"] &&
      rest.length === 0 &&
      first instanceof IndexColumnDefinition &&
      (first as IndexColumnDefinition<string, AnyColumnDefinition>)["_column"].name === column.name
    ) {
      return true;
    }
  }

  return false;
}

/** How a column is named in an error: `"articles.authorId"`. */
function labelOf(column: AnyColumnDefinition, index: ReferenceIndex): string {
  const table = index.owners.get(column);

  if (!table) {
    return column.name;
  }

  const field = Object.entries(table.columns).find(([, candidate]) => candidate === column)?.[0];

  return `${index.aliases.get(table) ?? table.name}.${field ?? column.name}`;
}

/** How a reference's relation is named: `relation "author" on table "articles"`. */
function describeVia(reference: Reference, index: ReferenceIndex): string {
  const { field, source, union } = reference.via;

  return union
    ? `relation "${field}" on union "${index.unions.get(union) ?? union.name}"`
    : `relation "${field}" on table "${index.aliases.get(source) ?? source.name}"`;
}

/** How a chain end is named in an error. */
function describeEnd(end: End, index: ReferenceIndex): string {
  if (end.kind === "table") {
    return `"${labelOf(end.column, index)}"`;
  }

  const { union, discriminator } = end.reference;
  const alias = index.unions.get(union) ?? union.name;

  return discriminator
    ? `union "${alias}" (per "${labelOf(discriminator, index)}")`
    : `union "${alias}"`;
}
