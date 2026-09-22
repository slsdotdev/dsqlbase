import { TypedObject, Prettify, WithMeta } from "../utils/index.js";
import {
  AnyColumnDefinition,
  AnyFieldRelation,
  AnyRelationDefinition,
  AnyTableDefinition,
  AnyTableRelations,
  DefinitionSchema,
  RESERVED_FIELD_NAMES,
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

/**
 * The metadata a definition declared with `table().meta()`. Rebuilding a `Table` from the
 * definition's three type parameters would otherwise drop it, taking `$$meta`'s declared
 * half with it.
 */
export type DeclaredTableMeta<TDef> = TDef extends { __type: { meta: infer M } } ? M : unknown;

export type RuntimeTables<TSchema extends AnySchema> = {
  [K in keyof TSchema["tables"]]: TSchema["tables"][K] extends TableDefinition<
    infer Name,
    infer Columns,
    infer Schema
  >
    ? WithMeta<
        Table<Name, Columns, Schema, SchemaTableRelations<TSchema, Name>>,
        DeclaredTableMeta<TSchema["tables"][K]>
      >
    : never;
};

export type TableByAlias<
  TSchema extends AnySchema,
  TAlias extends string,
> = TAlias extends keyof TSchema["tables"]
  ? TSchema["tables"][TAlias] extends TableDefinition<infer Name, infer Columns, infer Schema>
    ? WithMeta<
        Table<Name, Columns, Schema, SchemaTableRelations<TSchema, Name>>,
        DeclaredTableMeta<TSchema["tables"][TAlias]>
      >
    : never
  : never;

export type TableByName<TSchema extends AnySchema, TName extends string> =
  TSchema["tables"] extends Record<string, infer Def>
    ? Def extends TableDefinition<TName, infer Columns, infer Schema>
      ? Table<TName, Columns, Schema, SchemaTableRelations<TSchema, TName>>
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

  private readonly _tables: Map<string, AnyTable>;
  private readonly _relations: Map<string, AnyTableRelations>;

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
        const tableName = node.table.name as DefinitionRelationsTableName<TDefinition>;

        if (relations[tableName]) {
          relations[tableName] = this._mergeTableRelations(
            relations[tableName],
            node.relations
          ) as SchemaRelationDefinitions<TDefinition>[DefinitionRelationsTableName<TDefinition>];

          continue;
        }

        relations[tableName] = node.relations;

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
        const table = new Table(def, relations, key);

        tables.set(def.name, table);
        tables.set(key, table);
      }
    }

    return tables;
  }

  /**
   * The field alias a column is declared under on `table`, or `undefined` when the column
   * does not belong to it. Identity, not name: a column from a different table that happens
   * to share a name is not a match, which is the copy-paste mistake this catches.
   */
  private _findColumnAlias(
    table: AnyTableDefinition,
    column: AnyColumnDefinition
  ): string | undefined {
    return Object.entries(table.columns).find(([, candidate]) => candidate === column)?.[0];
  }

  /**
   * Checks that a relation's column pairs line up: equal, non-zero length; each column
   * declared on the side it is listed under; both columns of a pair of the same type.
   *
   * The query builder correlates over every pair (`packages/core/src/runtime/query.ts`), so
   * a malformed relation would otherwise surface as a confusing SQL error at query time, or
   * not at all.
   */
  private _validateRelation(
    sourceName: string,
    field: string,
    relation: AnyFieldRelation,
    definitions: Map<string, AnyTableDefinition>
  ): void {
    const label = `Relation "${field}" on table "${sourceName}"`;
    const { from, to } = relation;

    if (from.length === 0 || to.length === 0) {
      throw new Error(`${label} must declare at least one column pair in "from" and "to".`);
    }

    if (from.length !== to.length) {
      throw new Error(
        `${label} pairs ${from.length} "from" column(s) with ${to.length} "to" column(s); ` +
          `the two sides must have the same length.`
      );
    }

    const source = definitions.get(sourceName);
    const target = definitions.get(relation.target.name);

    if (!source) {
      throw new Error(`${label} refers to a table that is not in the schema.`);
    }

    if (!target) {
      throw new Error(
        `${label} targets table "${relation.target.name}", which is not in the schema.`
      );
    }

    for (const [index, fromColumn] of from.entries()) {
      const toColumn = to[index];

      const fromAlias = this._findColumnAlias(source, fromColumn);
      const toAlias = this._findColumnAlias(target, toColumn);

      if (!fromAlias) {
        throw new Error(
          `${label}: "from" column "${fromColumn.name}" is not declared on table "${sourceName}".`
        );
      }

      if (!toAlias) {
        throw new Error(
          `${label}: "to" column "${toColumn.name}" is not declared on target table "${relation.target.name}".`
        );
      }

      const fromType = fromColumn["_dataType"];
      const toType = toColumn["_dataType"];

      if (fromType !== toType) {
        throw new Error(
          `${label}: "${sourceName}"."${fromAlias}" is "${fromType}" but ` +
            `"${relation.target.name}"."${toAlias}" is "${toType}"; ` +
            `both columns of a pair must have the same type.`
        );
      }
    }
  }

  private _buildRelations(schema: Schema<TDefinition>) {
    const map = new Map<string, AnyTableRelations>();

    const definitions = new Map<string, AnyTableDefinition>();

    for (const definition of Object.values<AnyTableDefinition>(schema.tables)) {
      if (definition instanceof TableDefinition) {
        definitions.set(definition.name, definition);
      }
    }

    for (const [tableName, relations] of Object.entries(
      schema.relations as Record<string, AnyTableRelations>
    )) {
      const table = this._tables.get(tableName);

      if (!table) {
        throw new Error(`Table not found for relations: ${tableName}`);
      }

      for (const [field, relation] of Object.entries(relations)) {
        // Columns and relations share one namespace: the client addresses both as fields of
        // the same model (`select`, `join`, and the keys of a result row), so a name can
        // only mean one of them.
        if (table.hasColumn(field)) {
          throw new Error(
            `Relation "${field}" on table "${tableName}" collides with a column of the same ` +
              `name. Columns and relations share one field namespace on a table.`
          );
        }

        // That one namespace also excludes the names the runtime writes onto result rows.
        if (RESERVED_FIELD_NAMES.includes(field)) {
          throw new Error(
            `Table "${tableName}" declares a relation named "${field}", which is reserved. ` +
              `The runtime writes ${RESERVED_FIELD_NAMES.join(" and ")} onto every result row.`
          );
        }

        this._validateRelation(tableName, field, relation, definitions);
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

  /**
   * One entry per table, keyed by schema alias. Unlike `getTables()`, which holds every
   * table under both its alias and its database name, this never yields the same table
   * twice — use it whenever you iterate tables to build something per table.
   */
  public getTableEntries(): [alias: string, table: AnyTable][] {
    const entries = new Map<string, AnyTable>();

    for (const table of this._tables.values()) {
      entries.set(table.alias, table);
    }

    return [...entries.entries()];
  }

  /**
   * The schema alias for a table, given either its alias or its database name.
   * Throws when no such table exists.
   */
  public getAlias(nameOrAlias: string): string {
    return this.getTable(nameOrAlias).alias;
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
