import type { RelationType } from "../definition/index.js";
import type { AnyColumn } from "./column.js";
import type { ComputedDiscriminator } from "./reference.js";
import type { AnyTable } from "./table.js";
import type { Union } from "./union.js";

type RelationBase = {
  /** The field the relation is read under. */
  readonly field: string;
  readonly type: RelationType;
  /** The table that has the relation. */
  readonly source: AnyTable;
  /**
   * Where the relation was written: `source` itself, or the union `source` is a member of, for a
   * relation declared on a union — which every member has, from its own columns.
   */
  readonly declaredOn: AnyTable | Union;
  /** The source's columns, paired index by index with the target's. */
  readonly from: readonly AnyColumn[];
};

/** A relation to one table. */
export type TableRelation = RelationBase & {
  readonly kind: "table";
  readonly target: AnyTable;
  readonly to: readonly AnyColumn[];
};

/** A relation to a union: the target's columns are resolved per member. */
export type UnionRelation = RelationBase & {
  readonly kind: "union";
  readonly target: Union;
  /** Member alias → that member's columns, paired index by index with `from`. */
  readonly members: Readonly<Record<string, readonly AnyColumn[]>>;
  /**
   * For a belongs-to: what names the member per row — the stored discriminator column, or a
   * computed one when the relation declares none. `undefined` for a has-many / has-one.
   */
  readonly discriminator?: AnyColumn | ComputedDiscriminator;
};

/**
 * A relation resolved against the built schema: every column a runtime `Column`, every target a
 * runtime `Table` or `Union`. Built once by `buildSchema`, so nothing downstream resolves a
 * relation definition again.
 */
export type RuntimeRelation = TableRelation | UnionRelation;
