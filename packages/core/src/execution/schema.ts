import { DefinitionNode } from "../definition/base.js";
import {
  AnyRelation,
  AnyRelationDefinition,
  AnyTableRelations,
  RelationsConfig,
  RelationsDefinition,
} from "../definition/relations.js";
import { AnyTableDefinition, TableDefinition } from "../definition/table.js";
import { TypedObject } from "../types/object.js";
import { Prettify } from "../types/prettify.js";
import { AnyTable, Table } from "./table.js";
import { RelationNameOf, Schema, SchemaRelations, SchemaTables } from "./types.js";

export type TableNameOf<TDefinition extends Record<string, DefinitionNode>> = {
  [K in keyof TDefinition]: TDefinition[K] extends AnyTableDefinition ? K : never;
}[keyof TDefinition];

export type FieldRelationOf<
  TDefinition extends Record<string, DefinitionNode>,
  TTableName extends string,
  K extends string,
> =
  TDefinition extends Record<string, infer Def>
    ? Def extends RelationsDefinition<TTableName, infer R>
      ? R extends RelationsConfig
        ? R["relations"][K] extends AnyRelation
          ? R["relations"][K]
          : never
        : never
      : never
    : never;

export type TableRelationFields<
  TDefinition extends Record<string, DefinitionNode>,
  TTableName extends string,
> =
  TDefinition extends Record<string, infer Def>
    ? Def extends RelationsDefinition<TTableName, infer R>
      ? R extends RelationsConfig
        ? keyof R["relations"]
        : never
      : never
    : never;

export type RelationDefinitionsOf<
  TDefinition extends Record<string, DefinitionNode>,
  TTableName extends string,
> = {
  [K in TableRelationFields<TDefinition, TTableName>]: FieldRelationOf<TDefinition, TTableName, K>;
};

export type RuntimeTables<TDefinition extends Record<string, DefinitionNode>> = {
  [K in TableNameOf<TDefinition>]: TDefinition[K] extends TableDefinition<infer Name, infer Config>
    ? Table<Name, Config, RelationDefinitionsOf<TDefinition, Name>>
    : never;
};

export class SchemaRegistry<
  TDefinition extends Record<string, DefinitionNode> = Record<string, DefinitionNode>,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  private _tables: Map<string, AnyTable>;
  private _relations: Map<string, AnyTableRelations>;

  constructor(definition: TDefinition) {
    const schema = this._validateAndTransformSchema(definition);

    this._tables = this._buildTables(schema);
    this._relations = this._buildRelations(schema);
  }

  private _mergeTableRelations(
    existing: AnyRelationDefinition["__type"]["relations"],
    newRelations: AnyRelationDefinition["__type"]["relations"]
  ) {
    for (const [name, relation] of Object.entries(newRelations)) {
      if (existing[name]) {
        throw new Error(`Duplicate relation name: ${name}`);
      }

      existing[name] = relation;
    }

    return existing;
  }

  private _validateAndTransformSchema(schema: TDefinition): Schema<TDefinition> {
    const relations = {} as SchemaRelations<TDefinition>;
    const tables = {} as SchemaTables<TDefinition>;

    for (const [name, node] of Object.entries(schema)) {
      if (node instanceof RelationsDefinition) {
        const tableName = node["_table"].name as RelationNameOf<TDefinition>;

        if (relations[tableName]) {
          relations[tableName] = this._mergeTableRelations(
            relations[tableName],
            node["_relations"]
          ) as SchemaRelations<TDefinition>[RelationNameOf<TDefinition>];

          continue;
        }

        relations[tableName] = node[
          "_relations"
        ] as SchemaRelations<TDefinition>[RelationNameOf<TDefinition>];

        continue;
      }

      if (node instanceof TableDefinition) {
        tables[name as TableNameOf<TDefinition>] =
          node as SchemaTables<TDefinition>[TableNameOf<TDefinition>];
        continue;
      }
    }

    return { tables, relations };
  }

  private _buildTables(schema: Schema<TDefinition>) {
    const tables = new Map<string, AnyTable>();

    for (const [key, def] of Object.entries(schema.tables)) {
      if (def instanceof TableDefinition) {
        const relations = schema.relations[def.name as RelationNameOf<TDefinition>];
        const table = new Table(def, relations as AnyTableRelations);

        tables.set(def.name, table);
        tables.set(key, table);
      }
    }

    return tables;
  }

  private _buildRelations(schema: Schema<TDefinition>) {
    const map = new Map<string, AnyTableRelations>();

    for (const [tableName, relations] of Object.entries(
      schema.relations as Record<string, AnyTableRelations>
    )) {
      const table = this._tables.get(tableName);

      if (!table) {
        throw new Error(`Table not found for relations: ${tableName}`);
      }

      map.set(tableName, relations);
    }

    return map;
  }

  public getTable(aliasOrName: string) {
    const table = this._tables.get(aliasOrName);

    if (!table) {
      throw new Error(`Table not found: ${aliasOrName}`);
    }

    return table;
  }

  public hasTable(aliasOrName: string): boolean {
    return this._tables.has(aliasOrName);
  }

  public getTables(): Prettify<RuntimeTables<TDefinition>> {
    return Object.fromEntries(this._tables.entries()) as RuntimeTables<TDefinition>;
  }

  public hasRelations(tableNameOrAlias: string): boolean {
    const table = this.getTable(tableNameOrAlias);
    return this._relations.has(table.name);
  }

  public getRelations(tableNameOrAlias: string) {
    const table = this.getTable(tableNameOrAlias);
    const relations = this._relations.get(table.name);

    if (!relations) {
      throw new Error(`Relations not found for table: ${tableNameOrAlias}`);
    }

    return relations;
  }

  public getRelationTarget(tableNameOrAlias: string, field: string) {
    const sourceTable = this.getTable(tableNameOrAlias);
    const relations = this._relations.get(sourceTable.name);

    if (!relations?.[field]) {
      throw new Error(`Relation not found for field: ${field} on table: ${sourceTable.name}`);
    }

    const targetTableName = relations[field].target.name;
    const targetTable = this.getTable(targetTableName);

    if (!targetTable) {
      throw new Error(
        `Target table not found for relation: ${field} on table: ${sourceTable.name}`
      );
    }

    return targetTable;
  }
}
