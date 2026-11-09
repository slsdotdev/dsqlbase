import { DefinitionNode, Kind, RelationType } from "./base.js";
import { AnyTableDefinition } from "./table.js";
import { AnyUnionDefinition, UnionDefinition } from "./union.js";

/** What a relation can point at: one table, or a union of tables. */
export type AnyRelationObject = AnyTableDefinition | AnyUnionDefinition;

export type RelationObjectColumn<TObject extends AnyRelationObject> = {
  [K in keyof TObject["__type"]["columns"]]: TObject["__type"]["columns"][K];
}[keyof TObject["__type"]["columns"]];

export type RelationTargetColumn<TObject extends AnyRelationObject> =
  TObject extends AnyTableDefinition
    ? RelationObjectColumn<TObject>[]
    : TObject extends AnyUnionDefinition
      ?
          | RelationObjectColumn<TObject>[]
          | {
              [K in keyof TObject["__type"]["members"]]: TObject["__type"]["members"][K] extends AnyTableDefinition
                ? RelationObjectColumn<TObject["__type"]["members"][K]>[]
                : never;
            }
      : never;

export type FieldRelation<
  TType extends RelationType,
  TSource extends AnyRelationObject,
  out TTarget extends AnyRelationObject,
> = {
  type: TType;
  target: TTarget;
  from: RelationObjectColumn<TSource>[];
  to: RelationTargetColumn<TTarget>;
  /**
   * The source column naming which member of a union a belongs-to row points at. Optional on
   * a belongs-to whose target is a union — without one, the member is computed when the query
   * runs — and refused everywhere else; see the registry.
   */
  discriminator?: RelationObjectColumn<TSource>;
};

export type RelationsConfig<TSource extends AnyRelationObject = AnyTableDefinition> = {
  table: TSource;
  relations: Record<string, FieldRelation<RelationType, TSource, AnyRelationObject>>;
};

export type AnyFieldRelation = FieldRelation<RelationType, AnyTableDefinition, AnyRelationObject>;
export type AnyTableRelations = Record<string, AnyFieldRelation>;
export type AnyRelationDefinition = RelationsDefinition<AnyTableDefinition, AnyTableRelations>;

export class RelationsDefinition<
  TSource extends AnyRelationObject,
  TRelations extends Record<string, FieldRelation<RelationType, TSource, AnyRelationObject>>,
> extends DefinitionNode<
  `${TSource["name"]}_relations`,
  { table: TSource; relations: TRelations }
> {
  public readonly kind = Kind.RELATIONS;

  readonly table: TSource;
  readonly relations: TRelations;

  constructor(table: TSource, relations: TRelations) {
    super(`${table.name}_relations`);

    this.table = table;
    this.relations = relations;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      table: {
        kind: this.table.kind,
        name: this.table.name,
      },
      relations: Object.fromEntries(
        Object.entries(this.relations).map(([name, relation]) => [
          name,
          {
            type: relation.type,
            target:
              relation.target instanceof UnionDefinition
                ? relation.target.toJSON()
                : { kind: relation.target.kind, name: relation.target.name },
            from: relation.from.map(toColumnJSON),
            to: Array.isArray(relation.to)
              ? relation.to.map(toColumnJSON)
              : Object.fromEntries(
                  Object.entries(
                    relation.to as Record<string, RelationObjectColumn<AnyTableDefinition>[]>
                  ).map(([alias, columns]) => [alias, columns.map(toColumnJSON)])
                ),
            ...(relation.discriminator && {
              discriminator: toColumnJSON(relation.discriminator),
            }),
          } as const,
        ])
      ),
    } as const;
  }
}

function toColumnJSON(column: DefinitionNode) {
  return { kind: column.kind, name: column.name };
}
