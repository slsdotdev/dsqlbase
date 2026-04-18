import {
  AnyTableDefinition,
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

export function hasMany<TSource extends AnyTableDefinition, TTarget extends AnyTableDefinition>(
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

export function belongsTo<TSource extends AnyTableDefinition, TTarget extends AnyTableDefinition>(
  target: TTarget,
  config: {
    from: FieldRelation<TSource, TTarget, "belongs_to">["from"];
    to: FieldRelation<TSource, TTarget, "belongs_to">["to"];
  }
): FieldRelation<TSource, TTarget, "belongs_to"> {
  return {
    type: Relation.BELONGS_TO,
    target,
    from: config.from,
    to: config.to,
  } as const as FieldRelation<TSource, TTarget, "belongs_to">;
}

export function hasOne<TSource extends AnyTableDefinition, TTarget extends AnyTableDefinition>(
  target: TTarget,
  config: {
    from: FieldRelation<TSource, TTarget, "has_one">["from"];
    to: FieldRelation<TSource, TTarget, "has_one">["to"];
  }
): FieldRelation<TSource, TTarget, "has_one"> {
  return {
    type: Relation.HAS_ONE,
    target,
    from: config.from,
    to: config.to,
  } as const as FieldRelation<TSource, TTarget, "has_one">;
}
