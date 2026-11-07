import { SQLContext, SQLNode, SQLParam, SQLScope, SQLStatement } from "../sql/nodes.js";
import { sql } from "../sql/tag.js";
import type { AnyColumn } from "./column.js";
import type { RuntimeRelation } from "./relation.js";
import type { Union } from "./union.js";

/**
 * Which member of a union a row's key points at, computed when the query runs: the first
 * member, in declaration order, holding a row with that key.
 *
 * ```sql
 * CASE WHEN EXISTS (SELECT 1 FROM "photos" AS "__d0" WHERE "__d0"."id" = "__t0"."post_id")
 *      THEN 'photos'
 *      WHEN EXISTS (SELECT 1 FROM "videos" AS "__d1" WHERE "__d1"."id" = "__t0"."post_id")
 *      THEN 'videos' END
 * ```
 *
 * Stands in for a stored discriminator wherever a relation declares none: a belongs-to a union
 * without one, and the foreign key of a relation whose source is a union. It renders as an
 * expression, so it compares like a column (`= 'photos'` in a join's correlation or a filter),
 * and is projected under {@link name} so a column's `read` hook reads it from the row as it would a
 * stored discriminator. Each probe is one key lookup per member per row, and it reads the
 * members without their row policies — it only says which member holds a key the row
 * already carries.
 */
export class ComputedDiscriminator implements SQLNode {
  /** The name it is projected under: the first key column's, suffixed `$key`. */
  readonly name: string;

  readonly union: Union;

  /** The referencing row's key columns. */
  readonly keys: readonly AnyColumn[];

  /** Member alias → the member's columns, paired index by index with {@link keys}. */
  readonly members: Readonly<Record<string, readonly AnyColumn[]>>;

  constructor(
    union: Union,
    keys: readonly AnyColumn[],
    members: Readonly<Record<string, readonly AnyColumn[]>>
  ) {
    this.union = union;
    this.keys = keys;
    this.members = members;
    this.name = `${keys[0].name}$key`;
  }

  /** A member alias as a parameter to compare this with, as `Column.param` does for a column. */
  public param(value: unknown): SQLNode {
    return new SQLParam(value);
  }

  /** The expression aliased as {@link name}, for a select list. */
  public projection(): SQLNode {
    return sql`${this} AS ${sql.identifier(this.name)}`;
  }

  toSQL(ctx: SQLContext): SQLStatement {
    const branches = this.union.memberAliases.map((alias, index) => {
      const member = this.union.getMember(alias);
      // The member is aliased inside its probe only, so the key columns — rendered outside the
      // scope — keep their own alias even when the key's table is the member itself.
      const scope = new Map<unknown, string>([[member, `__d${index}`]]);
      const conditions = this.members[alias].map((column, position) =>
        sql.eq(new SQLScope(scope, column), this.keys[position])
      );

      return sql`WHEN EXISTS (SELECT 1 FROM ${member} AS ${sql.identifier(`__d${index}`)} WHERE ${sql.and(conditions)}) THEN ${sql.literal(alias)}`;
    });

    return sql`CASE ${sql.join(branches, " ")} END`.toSQL(ctx);
  }
}

/** A foreign key pointing at one column of one table. */
export type TableReference = {
  readonly kind: "table";
  readonly column: AnyColumn;
  /** The relation that set the reference. */
  readonly via: RuntimeRelation;
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
  /**
   * What names the member per row: the referencing row's stored discriminator column, or a
   * {@link ComputedDiscriminator} when the relation declares none.
   */
  readonly discriminator: AnyColumn | ComputedDiscriminator;
  /** The relation that set the reference. */
  readonly via: RuntimeRelation;
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
