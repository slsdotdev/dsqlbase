import { TypedObject, Prettify } from "../utils/index.js";
import {
  AnyRelationDefinition,
  AnyTableRelations,
  DefinitionSchema,
  RelationsDefinition,
  TableDefinition,
} from "../definition/index.js";
import {
  AnySchema,
  DefinitionRelationsTableName,
  DefinitionTableName,
  Schema,
  SchemaRelationDefinitions,
  SchemaTableDefinitions,
  SchemaTableRelations,
} from "./base.js";
import { AnyTable, Table } from "./table.js";

export type RuntimeTables<TSchema extends AnySchema> = {
  [K in keyof TSchema["tables"]]: TSchema["tables"][K] extends TableDefinition<
    infer Name,
    infer Config
  >
    ? Table<Name, Config, SchemaTableRelations<TSchema, Name>>
    : never;
};

export type TableByAlias<
  TSchema extends AnySchema,
  TAlias extends string,
> = TAlias extends keyof TSchema["tables"]
  ? TSchema["tables"][TAlias] extends TableDefinition<infer Name, infer Config>
    ? Table<Name, Config, SchemaTableRelations<TSchema, Name>>
    : never
  : never;

export type TableByName<TSchema extends AnySchema, TName extends string> =
  TSchema["tables"] extends Record<string, infer Def>
    ? Def extends TableDefinition<TName, infer Config>
      ? Table<TName, Config, SchemaTableRelations<TSchema, TName>>
      : never
    : never;

export type TableByNameOrAlias<
  TSchema extends AnySchema,
  TName extends string,
> = keyof TSchema["tables"] extends never
  ? AnyTable
  : TableByAlias<TSchema, TName> extends never
    ? TableByName<TSchema, TName>
    : TableByAlias<TSchema, TName>;

export class SchemaRegistry<
  TDefinition extends DefinitionSchema = DefinitionSchema,
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
    const relations = {} as SchemaRelationDefinitions<TDefinition>;
    const tables = {} as SchemaTableDefinitions<TDefinition>;

    for (const [name, node] of Object.entries(schema)) {
      if (node instanceof RelationsDefinition) {
        const tableName = node["_table"].name as DefinitionRelationsTableName<TDefinition>;

        if (relations[tableName]) {
          relations[tableName] = this._mergeTableRelations(
            relations[tableName],
            node["_relations"]
          ) as SchemaRelationDefinitions<TDefinition>[DefinitionRelationsTableName<TDefinition>];

          continue;
        }

        relations[tableName] = node[
          "_relations"
        ] as SchemaRelationDefinitions<TDefinition>[DefinitionRelationsTableName<TDefinition>];

        continue;
      }

      if (node instanceof TableDefinition) {
        tables[name as DefinitionTableName<TDefinition>] =
          node as SchemaTableDefinitions<TDefinition>[DefinitionTableName<TDefinition>];
        continue;
      }
    }

    return { tables, relations };
  }

  private _buildTables(schema: Schema<TDefinition>) {
    const tables = new Map<string, AnyTable>();

    for (const [key, def] of Object.entries(schema.tables)) {
      if (def instanceof TableDefinition) {
        const relations = schema.relations[def.name as DefinitionRelationsTableName<TDefinition>];
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

  public getTable<TName extends string>(
    aliasOrName: TName
  ): TableByNameOrAlias<this["__type"], TName> {
    const table = this._tables.get(aliasOrName);

    if (!table) {
      throw new Error(`Table not found: ${aliasOrName}`);
    }

    return table as TableByNameOrAlias<this["__type"], TName>;
  }

  public hasTable(aliasOrName: string): boolean {
    return this._tables.has(aliasOrName);
  }

  public getTables(): Prettify<RuntimeTables<this["__type"]>> {
    return Object.fromEntries(this._tables.entries()) as RuntimeTables<this["__type"]>;
  }

  public hasRelations(tableNameOrAlias: string): boolean {
    if (!this.hasTable(tableNameOrAlias)) {
      return false;
    }

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
