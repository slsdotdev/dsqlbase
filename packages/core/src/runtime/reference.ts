import type { AnyColumn } from "./column.js";
import type { AnyTable } from "./table.js";
import type { Union } from "./union.js";

/** The relation that set a reference: the table it is declared on and its field name. */
export type RelationRef = {
  readonly table: AnyTable;
  readonly field: string;
};

/** A foreign key pointing at one column of one table. */
export type TableReference = {
  readonly kind: "table";
  readonly column: AnyColumn;
  readonly via: RelationRef;
};

/**
 * A foreign key pointing at a member of a union, chosen per row: the discriminator names the
 * member, and `members` holds the column the key points at on each one.
 */
export type UnionReference = {
  readonly kind: "union";
  readonly union: Union;
  /** Member alias → the member's column this key points at. */
  readonly members: Readonly<Record<string, AnyColumn>>;
  /** The column of the referencing row that holds a member alias. */
  readonly discriminator: AnyColumn;
  readonly via: RelationRef;
};

/**
 * What a column points at, as a relation declares it. References always sit on the foreign key,
 * as in SQL: a belongs-to sets one on its `from` columns, a has-many / has-one on its `to`
 * columns — so a relation declared on one table may set a reference on another's column.
 */
export type ColumnReference = TableReference | UnionReference;

/**
 * Where a chain of references stops: a column that references nothing further, or a union
 * reference, whose member is only known per row.
 */
export type ReferenceEnd =
  | { readonly kind: "table"; readonly column: AnyColumn }
  | { readonly kind: "union"; readonly reference: UnionReference };

export type ResolvedReferences = {
  /** Distinct chain ends, by identity. A column with no references ends at itself. */
  readonly ends: ReferenceEnd[];
  /** Set when a chain loops back onto a column already on it: the columns of the ring, in order. */
  readonly ring?: AnyColumn[];
};

export function isSameReference(a: ColumnReference, b: ColumnReference): boolean {
  if (a.kind === "table" && b.kind === "table") {
    return a.column === b.column;
  }

  if (a.kind === "union" && b.kind === "union") {
    return (
      a.union === b.union &&
      a.discriminator === b.discriminator &&
      Object.keys(a.members).length === Object.keys(b.members).length &&
      Object.entries(a.members).every(([alias, column]) => b.members[alias] === column)
    );
  }

  return false;
}
