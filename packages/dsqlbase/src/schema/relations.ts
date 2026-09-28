import {
  AnyRelationTarget,
  AnyTableDefinition,
  AnyUnionDefinition,
  FieldRelation,
  Relation,
  RelationsDefinition,
} from "@dsqlbase/core/definition";

export function relations<
  TTable extends AnyTableDefinition,
  TRelations extends Record<string, FieldRelation<TTable>>,
>(table: TTable, relations: TRelations) {
  return new RelationsDefinition(table, relations);
}

/**
 * `to` names the target's columns. For a union target it is either shared fields from
 * `union.columns`, or one column list per member when members store the key differently.
 */
export function hasMany<TSource extends AnyTableDefinition, TTarget extends AnyRelationTarget>(
  target: TTarget,
  config: {
    from: FieldRelation<TSource, TTarget, "has_many">["from"];
    to: FieldRelation<TSource, TTarget, "has_many">["to"];
  }
): FieldRelation<TSource, TTarget, "has_many"> {
  return {
    type: Relation.HAS_MANY,
    target,
    from: config.from,
    to: config.to,
  } as const as FieldRelation<TSource, TTarget, "has_many">;
}

/**
 * The belongs-to side of a relation. A belongs-to a union also takes `discriminator`: the
 * source column holding which member each row points at, as that member's schema alias.
 */
export function belongsTo<TSource extends AnyTableDefinition, TTarget extends AnyRelationTarget>(
  target: TTarget,
  config: {
    from: FieldRelation<TSource, TTarget, "belongs_to">["from"];
    to: FieldRelation<TSource, TTarget, "belongs_to">["to"];
  } & (TTarget extends AnyUnionDefinition
    ? { discriminator: NonNullable<FieldRelation<TSource, TTarget, "belongs_to">["discriminator"]> }
    : { discriminator?: never })
): FieldRelation<TSource, TTarget, "belongs_to"> {
  return {
    type: Relation.BELONGS_TO,
    target,
    from: config.from,
    to: config.to,
    ...(config.discriminator && { discriminator: config.discriminator }),
  } as const as FieldRelation<TSource, TTarget, "belongs_to">;
}

export function hasOne<TSource extends AnyTableDefinition, TTarget extends AnyRelationTarget>(
  target: TTarget,
  config: Pick<FieldRelation<TSource, TTarget, "has_one">, "from" | "to">
): FieldRelation<TSource, TTarget, "has_one"> {
  return {
    type: Relation.HAS_ONE,
    target,
    from: config.from,
    to: config.to,
  } as const as FieldRelation<TSource, TTarget, "has_one">;
}
