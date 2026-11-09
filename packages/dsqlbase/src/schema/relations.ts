import {
  AnyUnionDefinition,
  FieldRelation,
  Relation,
  RelationsDefinition,
  RelationType,
} from "@dsqlbase/core/definition";
import { AnyRelationObject } from "@dsqlbase/core/definition/relations";

/**
 * Declares the relations of a table, or of a union. A union's relations are every member's,
 * each from its own column: `relations(posts, { comments: hasMany(comments, { from:
 * [posts.columns.id], to: [comments.columns.postId] }) })` joins comments from a photo, from a
 * video, and from the union. Its target must be a table.
 */
export function relations<
  TSource extends AnyRelationObject,
  TRelations extends Record<string, FieldRelation<RelationType, TSource, AnyRelationObject>>,
>(table: TSource, relations: TRelations) {
  return new RelationsDefinition(table, relations);
}

/**
 * `to` names the target's columns. For a union target it is either shared fields from
 * `union.columns`, or one column list per member when members store the key differently.
 */
export function hasMany<TSource extends AnyRelationObject, TTarget extends AnyRelationObject>(
  target: TTarget,
  config: {
    from: FieldRelation<"has_many", TSource, TTarget>["from"];
    to: FieldRelation<"has_many", TSource, TTarget>["to"];
  }
): FieldRelation<"has_many", TSource, TTarget> {
  return {
    type: Relation.HAS_MANY,
    target,
    from: config.from,
    to: config.to,
  } as const as FieldRelation<"has_many", TSource, TTarget>;
}

/**
 * The belongs-to side of a relation. A belongs-to a union may also take `discriminator`: the
 * source column holding which member each row points at, as that member's schema alias.
 * Without one, the member is the first, in declaration order, holding the key — computed when
 * the query runs, one key lookup per member per row.
 */
export function belongsTo<TSource extends AnyRelationObject, TTarget extends AnyRelationObject>(
  target: TTarget,
  config: {
    from: FieldRelation<"belongs_to", TSource, TTarget>["from"];
    to: FieldRelation<"belongs_to", TSource, TTarget>["to"];
  } & (TTarget extends AnyUnionDefinition
    ? {
        discriminator?: NonNullable<FieldRelation<"belongs_to", TSource, TTarget>["discriminator"]>;
      }
    : { discriminator?: never })
): FieldRelation<"belongs_to", TSource, TTarget> {
  return {
    type: Relation.BELONGS_TO,
    target,
    from: config.from,
    to: config.to,
    ...(config.discriminator && { discriminator: config.discriminator }),
  } as const as FieldRelation<"belongs_to", TSource, TTarget>;
}

export function hasOne<TSource extends AnyRelationObject, TTarget extends AnyRelationObject>(
  target: TTarget,
  config: Pick<FieldRelation<"has_one", TSource, TTarget>, "from" | "to">
): FieldRelation<"has_one", TSource, TTarget> {
  return {
    type: Relation.HAS_ONE,
    target,
    from: config.from,
    to: config.to,
  } as const as FieldRelation<"has_one", TSource, TTarget>;
}
