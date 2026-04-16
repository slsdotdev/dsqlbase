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
    from: FieldRelation<TSource, TTarget>["from"];
    to: FieldRelation<TSource, TTarget>["to"];
  }
): FieldRelation<TSource, TTarget> {
  return {
    type: Relation.HAS_MANY,
    target,
    from: config.from,
    to: config.to,
  };
}

export function belongsTo<TSource extends AnyTableDefinition, TTarget extends AnyTableDefinition>(
  target: TTarget,
  config: {
    from: FieldRelation<TSource, TTarget>["from"];
    to: FieldRelation<TSource, TTarget>["to"];
  }
): FieldRelation<TSource, TTarget> {
  return {
    type: Relation.BELONGS_TO,
    target,
    from: config.from,
    to: config.to,
  };
}

export function hasOne<TSource extends AnyTableDefinition, TTarget extends AnyTableDefinition>(
  target: TTarget,
  config: {
    from: FieldRelation<TSource, TTarget>["from"];
    to: FieldRelation<TSource, TTarget>["to"];
  }
): FieldRelation<TSource, TTarget> {
  return {
    type: Relation.HAS_ONE,
    target,
    from: config.from,
    to: config.to,
  };
}
