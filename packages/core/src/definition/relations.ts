import { DefinitionNode, Kind, RelationType } from "./base.js";
import { AnyTableDefinition } from "./table.js";
import { AnyUnionDefinition, UnionDefinition } from "./union.js";

export type TableDefinitionColumn<TTable extends AnyTableDefinition> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["__type"]["columns"][K];
}[keyof TTable["__type"]["columns"]];

/** What a relation can point at: one table, or a union of tables. */
export type AnyRelationTarget = AnyTableDefinition | AnyUnionDefinition;

/**
 * What a relation can be declared on: one table, or a union — whose relations every member
 * then has, from its own columns. A union source targets a table only.
 */
export type AnyRelationSource = AnyTableDefinition | AnyUnionDefinition;

/** The columns a relation's `from` names on its source: a table's, or a union's declared fields. */
export type RelationSourceColumn<TSource extends AnyRelationSource> =
  TSource extends AnyTableDefinition
    ? TableDefinitionColumn<TSource>
    : TSource extends AnyUnionDefinition
      ? TSource["columns"][keyof TSource["columns"]]
      : never;

/**
 * The `to` side of a relation to a union: either fields the union declares, taken from
 * `union.columns`, which resolve to each member's own column, or one column list per member for
 * members that store the key under different fields.
 */
export type UnionTargetColumns<TUnion extends AnyUnionDefinition> =
  | TUnion["columns"][keyof TUnion["columns"]][]
  | { [A in keyof TUnion["members"]]: TableDefinitionColumn<TUnion["members"][A]>[] };

export type RelationTargetColumns<TTarget extends AnyRelationTarget> =
  TTarget extends AnyTableDefinition
    ? TableDefinitionColumn<TTarget>[]
    : TTarget extends AnyUnionDefinition
      ? UnionTargetColumns<TTarget>
      : never;

export type FieldRelation<
  TSource extends AnyRelationSource,
  TTarget extends AnyRelationTarget = AnyRelationTarget,
  TType extends RelationType = RelationType,
> = {
  target: TTarget;
  type: TType;
  from: RelationSourceColumn<TSource>[];
  to: RelationTargetColumns<TTarget>;
  /**
   * The source column naming which member of a union a belongs-to row points at. Optional on
   * a belongs-to whose target is a union — without one, the member is computed when the query
   * runs — and refused everywhere else; see the registry.
   */
  discriminator?: TSource extends AnyTableDefinition ? TableDefinitionColumn<TSource> : never;
};

export type RelationsConfig<TTable extends AnyRelationSource = AnyTableDefinition> = {
  table: TTable;
  relations: Record<string, FieldRelation<TTable, AnyRelationTarget, RelationType>>;
};

export type AnyFieldRelation = FieldRelation<AnyTableDefinition, AnyRelationTarget, RelationType>;
export type AnyTableRelations = Record<string, AnyFieldRelation>;
export type AnyRelationDefinition = RelationsDefinition<AnyTableDefinition, AnyTableRelations>;

export class RelationsDefinition<
  TTable extends AnyRelationSource,
  TRelations extends Record<string, FieldRelation<TTable, AnyRelationTarget, RelationType>>,
> extends DefinitionNode<`${TTable["name"]}_relations`, { table: TTable; relations: TRelations }> {
  public readonly kind = Kind.RELATIONS;

  readonly table: TTable;
  readonly relations: TRelations;

  constructor(table: TTable, relations: TRelations) {
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
                  Object.entries(relation.to).map(([alias, columns]) => [
                    alias,
                    columns.map(toColumnJSON),
                  ])
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
