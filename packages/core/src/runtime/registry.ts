import { TypedObject, Prettify, WithMeta } from "../utils/index.js";
import {
  AnyColumnDefinition,
  AnyFieldRelation,
  AnyRelationDefinition,
  AnyTableDefinition,
  AnyTableRelations,
  AnyUnionColumnDefinition,
  AnyUnionDefinition,
  DefinitionSchema,
  RESERVED_FIELD_NAMES,
  Relation,
  RelationsDefinition,
  TableDefinition,
  UnionColumnDefinition,
  UnionDefinition,
} from "../definition/index.js";
import {
  AnySchema,
  DefinitionRelationsTableName,
  DefinitionTableName,
  Schema,
  SchemaRelationDefinitions,
  SchemaTableDefinitions,
  SchemaTableRelations,
  SchemaUnionDefinitions,
} from "./base.js";
import { AnyColumn } from "./column.js";
import { ComputedDiscriminator } from "./reference.js";
import { AnyTable, Table } from "./table.js";
import { Union } from "./union.js";

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
  private readonly _unions: Map<string, Union>;

  /**
   * For every relation whose target is a union: source table name → field → member alias →
   * the member's `to` columns. Resolved once here, whether `to` was written as shared fields or
   * as one list per member, so nothing downstream has to know which.
   */
  private readonly _unionPairs = new Map<string, Map<string, Record<string, AnyColumn[]>>>();

  /**
   * For every belongs-to a union: source table name → field → what names the member per row —
   * its discriminator column, or a computed one when it declares none.
   */
  private readonly _discriminators = new Map<
    string,
    Map<string, AnyColumn | ComputedDiscriminator>
  >();

  /** Every computed discriminator, so one union and key columns share one. */
  private readonly _computed: ComputedDiscriminator[] = [];

  /**
   * Relations whose source is a union, as declared: each is also given to every member as a
   * relation of its own (see {@link _addUnionSourceRelations}), keyed here by those copies so
   * validation knows where they came from.
   */
  private readonly _unionSourceCopies = new Map<
    AnyFieldRelation,
    { union: AnyUnionDefinition; field: string; relation: AnyFieldRelation }
  >();

  /**
   * Every tenant claim declared anywhere in this schema, mapped to the data type it is
   * declared with. Empty when no table is inside a tenant scope.
   *
   * This is what `$identityClaims` picks an identity object apart by: a claim is identified by
   * its field name across the whole schema, so the same name must mean the same type
   * everywhere — two tables disagreeing is caught here rather than at the first query.
   */
  readonly claimKeys: Map<string, string>;

  constructor(definition: TDefinition) {
    const schema = this._validateAndTransformSchema(definition);

    this._tables = this._buildTables(schema);
    this._unions = this._buildUnions(schema, definition);
    this._relations = this._buildRelations(schema);
    this.claimKeys = this._buildClaimKeys(schema);

    for (const [, table] of this.getTableEntries()) {
      for (const [, column] of table.getColumnEntries()) {
        column._freezeReferences();
      }
    }
  }

  /**
   * Merges a second `relations()` declaration for the same table into the first.
   *
   * Merges into a copy, never into the definition: `relations()` objects belong to the schema
   * module, so mutating one would mean a second registry over the same schema re-merges what
   * the first already merged and reports every name as a duplicate. Two clients over one
   * schema is an ordinary thing to want — an enforcing one and an unscoped one, for instance.
   */
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
    const unions = {} as SchemaUnionDefinitions<TDefinition>;

    for (const [name, node] of Object.entries(schema)) {
      if (node instanceof RelationsDefinition && node.table instanceof UnionDefinition) {
        this._addUnionSourceRelations(
          node.table,
          node.relations as AnyTableRelations,
          relations as Record<string, AnyTableRelations>
        );
        continue;
      }

      if (node instanceof RelationsDefinition) {
        const tableName = node.table.name as DefinitionRelationsTableName<TDefinition>;

        if (relations[tableName]) {
          relations[tableName] = this._mergeTableRelations(
            relations[tableName],
            node.relations
          ) as SchemaRelationDefinitions<TDefinition>[DefinitionRelationsTableName<TDefinition>];

          continue;
        }

        relations[tableName] = {
          ...node.relations,
        } as SchemaRelationDefinitions<TDefinition>[DefinitionRelationsTableName<TDefinition>];

        continue;
      }

      if (node instanceof TableDefinition) {
        tables[name as DefinitionTableName<TDefinition>] =
          node as SchemaTableDefinitions<TDefinition>[DefinitionTableName<TDefinition>];
        continue;
      }

      if (node instanceof UnionDefinition) {
        (unions as Record<string, AnyUnionDefinition>)[name] = node;
        continue;
      }
    }

    return { tables, relations, unions };
  }

  /**
   * Gives every member of a union the relations declared with the union as their source, each
   * with `from` resolved to the member's own columns — so `posts` hasMany `comments` is
   * `photos` hasMany `comments` and `videos` hasMany `comments`. A join from a union branch,
   * or from a member read on its own, is then an ordinary table join.
   *
   * A has-many / has-one sets one union reference on the foreign key instead of one per member
   * (see `_buildRelations`): the key holds an id of whichever member the row points at.
   */
  private _addUnionSourceRelations(
    union: AnyUnionDefinition,
    declared: AnyTableRelations,
    relations: Record<string, AnyTableRelations>
  ): void {
    for (const [field, relation] of Object.entries(declared)) {
      const label = `Relation "${field}" on ${union.name}`;

      if (!(relation.target instanceof TableDefinition)) {
        throw new Error(
          `${label} targets a union. A relation whose source is a union must target a table.`
        );
      }

      if (relation.discriminator) {
        throw new Error(
          `${label} declares a discriminator, but only a belongs-to a union needs one.`
        );
      }

      for (const column of relation.from as unknown[]) {
        if (!(column instanceof UnionColumnDefinition) || union.columns[column.name] !== column) {
          throw new Error(
            `${label}: a "from" column must be a field the union declares ` +
              `(\`union.columns.<field>\`).`
          );
        }
      }

      for (const [alias, member] of Object.entries<AnyTableDefinition>(union.members)) {
        const copy = {
          ...relation,
          from: (relation.from as unknown as AnyUnionColumnDefinition[]).map(
            (column) => column.members[alias]
          ),
        } as AnyFieldRelation;

        this._unionSourceCopies.set(copy, { union, field, relation });

        const existing = relations[member.name];

        if (existing?.[field]) {
          throw new Error(
            `${label} has the same name as relation "${field}" on its member "${alias}".`
          );
        }

        relations[member.name] = { ...existing, [field]: copy };
      }
    }
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
   * Builds every union once the tables exist, checking what only the schema object can tell:
   * that each member is keyed by the alias it is exported under. That is what makes a member
   * key mean the same thing as `$$meta.key` and a node key, rather than a second name for the
   * same table.
   */
  private _buildUnions(schema: Schema<TDefinition>, definition: TDefinition) {
    const unions = new Map<string, Union>();

    for (const [alias, union] of Object.entries<AnyUnionDefinition>(schema.unions)) {
      if (this._tables.has(alias)) {
        throw new Error(
          `Union "${alias}" has the same name as a table in the schema. A union and a table ` +
            `are both read through the client by that name, so it can only mean one of them.`
        );
      }

      const members: Record<string, AnyTable> = {};

      for (const [key, member] of Object.entries<AnyTableDefinition>(union.members)) {
        if (definition[key] !== member) {
          throw new Error(
            `Union "${alias}" lists table "${member.name}" under "${key}", but the schema does ` +
              `not export that table as "${key}". Union members are keyed by their schema alias.`
          );
        }

        members[key] = this.getTable(key);
      }

      unions.set(alias, new Union(union, members, alias));
    }

    return unions;
  }

  private _buildClaimKeys(schema: Schema<TDefinition>): Map<string, string> {
    const claims = new Map<string, string>();
    const sources = new Map<string, string>();

    for (const [key, def] of Object.entries<AnyTableDefinition>(schema.tables)) {
      const table = this._tables.get(key);

      if (!table) {
        continue;
      }

      for (const [claim] of table.tenantKeys) {
        const dataType = def.columns[claim]["_dataType"] as string;
        const declared = claims.get(claim);

        if (declared !== undefined && declared !== dataType) {
          throw new Error(
            `Claim "${claim}" is "${declared}" on table "${sources.get(claim)}" but "${dataType}" ` +
              `on table "${def.name}". One claim name means one claim, so it must have the same ` +
              `type on every table that declares it.`
          );
        }

        claims.set(claim, dataType);
        sources.set(claim, def.name);
      }
    }

    return claims;
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
    const copied = this._unionSourceCopies.get(relation);
    const label = copied
      ? `Relation "${field}" on ${copied.union.name} (member table "${sourceName}")`
      : `Relation "${field}" on table "${sourceName}"`;
    const { from } = relation;
    const source = definitions.get(sourceName);

    if (!source) {
      throw new Error(`${label} refers to a table that is not in the schema.`);
    }

    if (from.length === 0) {
      throw new Error(`${label} must declare at least one column pair in "from" and "to".`);
    }

    if (relation.target instanceof UnionDefinition) {
      this._validateUnionRelation(label, sourceName, field, relation, source);
      return;
    }

    const to = relation.to as AnyColumnDefinition[];

    if (to.length === 0) {
      throw new Error(`${label} must declare at least one column pair in "from" and "to".`);
    }

    if (from.length !== to.length) {
      throw new Error(
        `${label} pairs ${from.length} "from" column(s) with ${to.length} "to" column(s); ` +
          `the two sides must have the same length.`
      );
    }

    if (relation.discriminator) {
      throw new Error(
        `${label} declares a discriminator, but its target is a single table. Only a ` +
          `belongs-to a union needs one.`
      );
    }

    const target = definitions.get(relation.target.name);

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

      // The reference sits on the foreign key, as in SQL: the `from` of a belongs-to, the `to`
      // of a has-many / has-one — so a has-many declared here writes onto the target's column.
      const fromRuntime = this.getTable(sourceName).getColumn(fromAlias) as AnyColumn;
      const toRuntime = this.getTable(relation.target.name).getColumn(toAlias) as AnyColumn;
      const via = { table: this.getTable(sourceName), field };

      if (relation.type === Relation.BELONGS_TO) {
        fromRuntime._addReference({ kind: "table", column: toRuntime, via });
      } else if (!copied) {
        toRuntime._addReference({ kind: "table", column: fromRuntime, via });
      }
    }
  }

  /**
   * The union half of {@link _validateRelation}: the union must be registered, `to` must name
   * a column on every member — through a shared field or a per-member list — paired with
   * `from` by type, and only a belongs-to may carry a discriminator. Without one, the member is
   * computed when the query runs.
   */
  private _validateUnionRelation(
    label: string,
    sourceName: string,
    field: string,
    relation: AnyFieldRelation,
    source: AnyTableDefinition
  ): void {
    const target = relation.target as AnyUnionDefinition;
    const union = [...this._unions.values()].find((candidate) => candidate.definition === target);

    if (!union) {
      throw new Error(`${label} targets ${target.name}, which is not in the schema.`);
    }

    const { from } = relation;
    const lists = this._getMemberToColumns(label, union, relation.to);
    const pairs: Record<string, AnyColumn[]> = {};

    for (const [alias, to] of Object.entries(lists)) {
      const member = union.getMember(alias);
      const memberDefinition = union.definition.members[alias] as AnyTableDefinition;

      if (to.length !== from.length) {
        throw new Error(
          `${label} pairs ${from.length} "from" column(s) with ${to.length} "to" column(s) on ` +
            `member "${alias}"; the two sides must have the same length.`
        );
      }

      pairs[alias] = to.map((toColumn, index) => {
        const fromColumn = from[index];
        const fromAlias = this._findColumnAlias(source, fromColumn);
        const toAlias = this._findColumnAlias(memberDefinition, toColumn);

        if (!fromAlias) {
          throw new Error(
            `${label}: "from" column "${fromColumn.name}" is not declared on table "${sourceName}".`
          );
        }

        if (!toAlias) {
          throw new Error(
            `${label}: "to" column "${toColumn.name}" is not declared on member "${alias}" of ` +
              `union "${union.alias}".`
          );
        }

        if (fromColumn["_dataType"] !== toColumn["_dataType"]) {
          throw new Error(
            `${label}: "${sourceName}"."${fromAlias}" is "${fromColumn["_dataType"]}" but ` +
              `"${alias}"."${toAlias}" is "${toColumn["_dataType"]}"; both columns of a pair ` +
              `must have the same type.`
          );
        }

        return member.getColumn(toAlias) as AnyColumn;
      });
    }

    this._validateDiscriminator(label, relation, source, union);

    const sourceTable = this.getTable(sourceName);
    const via = { table: sourceTable, field };
    let discriminator: AnyColumn | ComputedDiscriminator | undefined;

    const fromColumns = from.map(
      (definition) =>
        sourceTable.getColumn(this._findColumnAlias(source, definition) as string) as AnyColumn
    );

    if (relation.type === Relation.BELONGS_TO) {
      const byField =
        this._discriminators.get(sourceName) ??
        new Map<string, AnyColumn | ComputedDiscriminator>();

      // Without a stored discriminator, the member is the first one holding the key.
      discriminator = relation.discriminator
        ? (sourceTable.getColumn(
            this._findColumnAlias(source, relation.discriminator) as string
          ) as AnyColumn)
        : this._getComputedDiscriminator(union, fromColumns, pairs);

      byField.set(field, discriminator);
      this._discriminators.set(sourceName, byField);
    }

    // On the foreign key, as for a table target: a belongs-to's `from` points at whichever
    // member its discriminator names; a has-many / has-one sets one on every member's `to`.
    for (const [index, fromColumn] of fromColumns.entries()) {
      if (relation.type === Relation.BELONGS_TO) {
        fromColumn._addReference({
          kind: "union",
          union,
          members: Object.fromEntries(
            Object.entries(pairs).map(([alias, to]) => [alias, to[index]])
          ),
          discriminator: discriminator as AnyColumn | ComputedDiscriminator,
          via,
        });
        continue;
      }

      for (const to of Object.values(pairs)) {
        to[index]._addReference({ kind: "table", column: fromColumn, via });
      }
    }

    const byField =
      this._unionPairs.get(sourceName) ?? new Map<string, Record<string, AnyColumn[]>>();
    byField.set(field, pairs);
    this._unionPairs.set(sourceName, byField);
  }

  /** `to` as one column-definition list per member, whichever form it was written in. */
  private _getMemberToColumns(
    label: string,
    union: Union,
    to: AnyFieldRelation["to"]
  ): Record<string, AnyColumnDefinition[]> {
    if (Array.isArray(to)) {
      if (to.length === 0) {
        throw new Error(`${label} must declare at least one column pair in "from" and "to".`);
      }

      return Object.fromEntries(
        union.memberAliases.map((alias) => [
          alias,
          (to as unknown[]).map((column) => {
            if (
              !(column instanceof UnionColumnDefinition) ||
              union.definition.columns[column.name] !== column
            ) {
              throw new Error(
                `${label}: a "to" column given as a list must be a shared field of union ` +
                  `"${union.alias}" (\`${union.alias}.columns.<field>\`). To name a different ` +
                  `column per member, pass one list per member instead.`
              );
            }

            return column.members[alias];
          }),
        ])
      );
    }

    const lists = to as Record<string, AnyColumnDefinition[]>;
    const given = Object.keys(lists);
    const missing = union.memberAliases.filter((alias) => !given.includes(alias));
    const unknown = given.filter((alias) => !union.hasMember(alias));

    if (missing.length > 0 || unknown.length > 0) {
      throw new Error(
        `${label} must name one "to" column list per member of union "${union.alias}" ` +
          `(${union.memberAliases.join(", ")})` +
          (missing.length > 0 ? `; missing: ${missing.join(", ")}` : "") +
          (unknown.length > 0 ? `; not members: ${unknown.join(", ")}` : "") +
          `.`
      );
    }

    return lists;
  }

  /**
   * A belongs-to a union may store which member it points at in a column of its own — the
   * discriminator, holding a member alias. Without one, the member is the first holding the
   * key, computed when the query runs. Has-many and has-one to a union need none, since the key
   * lives on each member, so one there is a mistake.
   */
  private _validateDiscriminator(
    label: string,
    relation: AnyFieldRelation,
    source: AnyTableDefinition,
    union: Union
  ): void {
    const { discriminator } = relation;

    if (relation.type !== Relation.BELONGS_TO) {
      if (discriminator) {
        throw new Error(
          `${label} declares a discriminator, but only a belongs-to a union needs one: the ` +
            `members of "${union.alias}" hold the key.`
        );
      }

      return;
    }

    // Optional: without one, the member is computed when the query runs.
    if (!discriminator) {
      return;
    }

    const alias = this._findColumnAlias(source, discriminator);

    if (!alias) {
      throw new Error(
        `${label}: discriminator "${discriminator.name}" is not declared on table "${source.name}".`
      );
    }

    const dataType = discriminator["_dataType"] as string;
    const textLike =
      discriminator["_domain"] !== undefined ||
      dataType === "text" ||
      /^(varchar|char)\(\d+\)$/.test(dataType);

    if (!textLike) {
      throw new Error(
        `${label}: discriminator "${source.name}"."${alias}" is "${dataType}"; it holds a ` +
          `member alias, so it must be text, varchar, char, or a text domain.`
      );
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

    this._setUnionSourceReferences();

    return map;
  }

  /**
   * The computed discriminator of `keys` over `union`, made once: a belongs-to a union and a
   * has-many from it over the same key are one reference, so they must share it.
   */
  private _getComputedDiscriminator(
    union: Union,
    keys: AnyColumn[],
    members: Record<string, AnyColumn[]>
  ): ComputedDiscriminator {
    const known = this._computed.find(
      (candidate) =>
        candidate.union === union &&
        candidate.keys.length === keys.length &&
        candidate.keys.every((key, index) => key === keys[index]) &&
        union.memberAliases.every((alias) =>
          candidate.members[alias].every((column, index) => column === members[alias][index])
        )
    );

    if (known) {
      return known;
    }

    const discriminator = new ComputedDiscriminator(union, keys, members);
    this._computed.push(discriminator);

    return discriminator;
  }

  /**
   * The foreign key of a has-many / has-one whose source is a union holds an id of whichever
   * member its row points at, and nothing stored says which: one union reference per key
   * column, its discriminator computed when the query runs. A belongs-to from a union needs
   * nothing here — its key is on each member, and each member's copy set an ordinary reference.
   */
  private _setUnionSourceReferences(): void {
    const declared = new Map<
      AnyFieldRelation,
      { union: AnyUnionDefinition; field: string; relation: AnyFieldRelation }
    >();

    for (const source of this._unionSourceCopies.values()) {
      declared.set(source.relation, source);
    }

    for (const { union: definition, field, relation } of declared.values()) {
      if (relation.type === Relation.BELONGS_TO) {
        continue;
      }

      const union = [...this._unions.values()].find(
        (candidate) => candidate.definition === definition
      );

      if (!union) {
        throw new Error(
          `Relation "${field}" on ${definition.name}: the union is not in the schema.`
        );
      }

      const target = this.getTable(relation.target.name);
      const targetDefinition = relation.target as AnyTableDefinition;
      const keys = (relation.to as AnyColumnDefinition[]).map(
        (column) =>
          target.getColumn(this._findColumnAlias(targetDefinition, column) as string) as AnyColumn
      );
      const pairs = Object.fromEntries(
        union.memberAliases.map((alias) => [
          alias,
          (relation.from as unknown as AnyUnionColumnDefinition[]).map((column) =>
            union.getMemberColumn(alias, column.name)
          ),
        ])
      );
      // A belongs-to back to the union over the same key already says which member — its
      // stored discriminator, or a computed one — so the has-many shares it rather than
      // computing a second.
      const back = keys[0].references.find(
        (reference) =>
          reference.kind === "union" &&
          reference.union === union &&
          union.memberAliases.every((alias) => reference.members[alias] === pairs[alias][0])
      );
      const discriminator =
        back?.kind === "union"
          ? back.discriminator
          : this._getComputedDiscriminator(union, keys, pairs);

      for (const [index, key] of keys.entries()) {
        key._addReference({
          kind: "union",
          union,
          members: Object.fromEntries(
            Object.entries(pairs).map(([alias, columns]) => [alias, columns[index]])
          ),
          discriminator,
          via: { table: union, field },
        });
      }
    }
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

  public hasUnion(alias: string): boolean {
    return this._unions.has(alias);
  }

  public getUnion(alias: string): Union {
    const union = this._unions.get(alias);

    if (!union) {
      throw new Error(`Union not found: ${alias}`);
    }

    return union;
  }

  /** One entry per union, keyed by schema alias. */
  public getUnions(): [alias: string, union: Union][] {
    return [...this._unions.entries()];
  }

  /**
   * What a relation points at: a table, or a union when the relation targets one. Callers
   * that only handle tables must narrow with `instanceof Union`.
   */
  public getRelationTarget(tableNameOrAlias: string, field: string): AnyTable | Union {
    const sourceTable = this.getTable(tableNameOrAlias);
    const relations = this._relations.get(sourceTable.name);

    if (!relations?.[field]) {
      throw new Error(`Relation not found for field: ${field} on table: ${sourceTable.name}`);
    }

    const target = relations[field].target;

    if (target instanceof UnionDefinition) {
      const union = [...this._unions.values()].find((candidate) => candidate.definition === target);

      if (!union) {
        throw new Error(
          `Target union not found for relation: ${field} on table: ${sourceTable.name}`
        );
      }

      return union;
    }

    return this.getTable(target.name);
  }

  /**
   * The `to` columns of a relation to a union, per member alias — each member's own columns,
   * paired index by index with the relation's `from`.
   */
  /**
   * The discriminator column of a belongs-to a union — the source column naming which member
   * each row points at — or `undefined` for any other relation.
   */
  public getRelationDiscriminator(
    tableNameOrAlias: string,
    field: string
  ): AnyColumn | ComputedDiscriminator | undefined {
    const sourceTable = this.getTable(tableNameOrAlias);

    return this._discriminators.get(sourceTable.name)?.get(field);
  }

  public getUnionRelationColumns(
    tableNameOrAlias: string,
    field: string
  ): Record<string, AnyColumn[]> {
    const sourceTable = this.getTable(tableNameOrAlias);
    const pairs = this._unionPairs.get(sourceTable.name)?.get(field);

    if (!pairs) {
      throw new Error(
        `Relation "${field}" on table "${sourceTable.name}" does not target a union.`
      );
    }

    return pairs;
  }
}
