import { DefinitionNode, Kind, RelationType } from "./base.js";
import { AnyTableDefinition } from "./table.js";

export type TableDefinitionColumn<TTable extends AnyTableDefinition> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["__type"]["columns"][K];
}[keyof TTable["__type"]["columns"]];

export interface FieldRelation<
  TSource extends AnyTableDefinition,
  TTarget extends AnyTableDefinition = AnyTableDefinition,
  TType extends RelationType = RelationType,
> {
  target: TTarget;
  type: TType;
  from: TSource extends AnyTableDefinition ? TableDefinitionColumn<TSource>[] : never;
  to: TTarget extends AnyTableDefinition ? TableDefinitionColumn<TTarget>[] : never;
}

export interface RelationsConfig<TTable extends AnyTableDefinition = AnyTableDefinition> {
  table: TTable;
  relations: Record<string, FieldRelation<TTable, AnyTableDefinition, RelationType>>;
}

export type AnyFieldRelation = FieldRelation<AnyTableDefinition, AnyTableDefinition, RelationType>;
export type AnyTableRelations = Record<string, AnyFieldRelation>;
export type AnyRelationDefinition = RelationsDefinition<AnyTableDefinition, AnyTableRelations>;

export class RelationsDefinition<
  TTable extends AnyTableDefinition,
  TRelations extends Record<string, FieldRelation<TTable, AnyTableDefinition, RelationType>>,
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
            target: {
              kind: relation.target.kind,
              name: relation.target.name,
            },
            from: relation.from.map((col) => ({
              kind: col.kind,
              name: col.name,
            })),
            to: relation.to.map((col) => ({
              kind: col.kind,
              name: col.name,
            })),
          } as const,
        ])
      ),
    } as const;
  }
}
