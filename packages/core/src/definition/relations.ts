import { DefinitionNode, Kind, RelationType } from "./base.js";
import { AnyTableDefinition, TableConfig, TableDefinition } from "./table.js";

export interface Relation<
  TSource extends TableDefinition<string, TableConfig>,
  TTarget extends TableDefinition<string, TableConfig> = TableDefinition<string, TableConfig>,
> {
  target: TTarget;
  type: RelationType;

  from: TSource extends AnyTableDefinition
    ? TSource["__type"] extends TableConfig
      ? TSource["__type"]["columns"] extends Record<string, infer CDef>
        ? CDef[]
        : never
      : never
    : never;
  to: TTarget extends AnyTableDefinition
    ? TTarget["__type"] extends TableConfig
      ? TTarget["__type"]["columns"] extends Record<string, infer CDef>
        ? CDef[]
        : never
      : never
    : never;
}

export interface RelationsConfig<TTable extends AnyTableDefinition = AnyTableDefinition> {
  table: TTable;
  relations: Record<string, Relation<TTable>>;
}

export type AnyRelation = Relation<AnyTableDefinition, AnyTableDefinition>;
export type AnyTableRelations = Record<string, AnyRelation>;
export type AnyRelationDefinition = RelationsDefinition<string, RelationsConfig>;

export class RelationsDefinition<
  TTableName extends string,
  TConfig extends RelationsConfig<TableDefinition<TTableName, TableConfig>>,
> extends DefinitionNode<`${TTableName}_relations`, TConfig> {
  public readonly kind = Kind.RELATIONS;

  private _table: TConfig["table"];
  private _relations: TConfig["relations"];

  constructor(tableName: TTableName, config: TConfig) {
    super(`${tableName}_relations`);

    this._table = config.table;
    this._relations = config.relations;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      table: {
        kind: this._table.kind,
        name: this._table.name,
      },
      relations: Object.fromEntries(
        Object.entries(this._relations).map(([name, relation]) => [
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
