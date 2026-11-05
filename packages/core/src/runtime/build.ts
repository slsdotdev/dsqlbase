import {
  AnyColumnDefinition,
  AnyTableDefinition,
  AnyUnionDefinition,
  DefinitionSchema,
  Relation,
  SourcedRelation,
  TableDefinition,
  UnionDefinition,
  collectRelations,
  findColumnAlias,
  memberToColumns,
} from "../definition/index.js";
import { AnyColumn } from "./column.js";
import { ComputedDiscriminator } from "./reference.js";
import { RuntimeRelation, TableRelation } from "./relation.js";
import { AnyTable, Table } from "./table.js";
import { Union } from "./union.js";

/** A schema's runtime objects, as `SchemaRegistry` holds them. */
export type BuiltSchema = {
  /** Every table, under both its schema alias and its database name. */
  readonly tables: Map<string, AnyTable>;
  /** Every union, by schema alias. */
  readonly unions: Map<string, Union>;
  /** Every table's relations, by field. A table with none has no entry. */
  readonly relations: Map<AnyTable, Readonly<Record<string, RuntimeRelation>>>;
  /** Every tenant claim name, mapped to the data type it is declared with. */
  readonly claimKeys: Map<string, string>;
};

/**
 * Builds the runtime objects of a schema `validateSchema` accepted: tables, unions, relations
 * resolved to runtime columns, and the references those relations set on their foreign keys.
 *
 * It checks nothing; given a schema that was not validated, it may build nonsense or throw on
 * a missing column. Nothing it uses while building outlives the call.
 */
export function buildSchema(schema: DefinitionSchema): BuiltSchema {
  const tables = new Map<string, AnyTable>();
  const tableOf = new Map<AnyTableDefinition, AnyTable>();

  for (const [alias, node] of Object.entries(schema)) {
    if (node instanceof TableDefinition) {
      const table = new Table(node, alias);

      tables.set(node.name, table);
      tables.set(alias, table);
      tableOf.set(node, table);
    }
  }

  const unions = new Map<string, Union>();
  const unionOf = new Map<AnyUnionDefinition, Union>();

  for (const [alias, node] of Object.entries(schema)) {
    if (node instanceof UnionDefinition) {
      const members = Object.fromEntries(
        Object.entries<AnyTableDefinition>(node.members).map(([key, member]) => [
          key,
          tableOf.get(member) as AnyTable,
        ])
      );
      const union = new Union(node, members, alias);

      unions.set(alias, union);
      unionOf.set(node, union);
    }
  }

  const computed = computedDiscriminators();
  const all: RuntimeRelation[] = [];
  const relations = new Map<AnyTable, Record<string, RuntimeRelation>>();

  for (const entry of collectRelations(schema)) {
    const relation = buildRelation(entry, tableOf, unionOf, computed);
    const byField = relations.get(relation.source) ?? {};

    byField[relation.field] = relation;
    relations.set(relation.source, byField);
    all.push(relation);
  }

  linkReferences(all, computed);

  const unique = new Set(tables.values());

  for (const table of unique) {
    for (const [, column] of table.getColumnEntries()) {
      column._freezeReferences();
    }
  }

  const claimKeys = new Map<string, string>();

  for (const table of unique) {
    for (const [claim, column] of table.tenantKeys) {
      claimKeys.set(claim, column.dataType);
    }
  }

  for (const [table, byField] of relations) {
    relations.set(table, Object.freeze(byField));
  }

  return { tables, unions, relations, claimKeys };
}

/** The runtime column a definition column is declared as on `table`. */
function columnOf(
  table: AnyTable,
  definition: AnyTableDefinition,
  column: AnyColumnDefinition
): AnyColumn {
  return table.getColumn(findColumnAlias(definition, column) as string) as AnyColumn;
}

type ComputedDiscriminators = (
  union: Union,
  keys: readonly AnyColumn[],
  members: Readonly<Record<string, readonly AnyColumn[]>>
) => ComputedDiscriminator;

/**
 * Makes computed discriminators, one per union and key columns: a belongs-to a union and a
 * has-many from it over the same key are one reference, so they must share one.
 */
function computedDiscriminators(): ComputedDiscriminators {
  const made: ComputedDiscriminator[] = [];

  return (union, keys, members) => {
    const known = made.find(
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
    made.push(discriminator);

    return discriminator;
  };
}

function buildRelation(
  entry: SourcedRelation,
  tableOf: ReadonlyMap<AnyTableDefinition, AnyTable>,
  unionOf: ReadonlyMap<AnyUnionDefinition, Union>,
  computed: ComputedDiscriminators
): RuntimeRelation {
  const { field, relation } = entry;
  const source = tableOf.get(entry.source) as AnyTable;
  const declaredOn = entry.union ? (unionOf.get(entry.union) as Union) : source;
  const from = relation.from.map((column) => columnOf(source, entry.source, column));
  const base = { field, type: relation.type, source, declaredOn, from };

  if (!(relation.target instanceof UnionDefinition)) {
    const definition = relation.target;
    const target = tableOf.get(definition) as AnyTable;

    return {
      ...base,
      kind: "table",
      target,
      to: (relation.to as AnyColumnDefinition[]).map((column) =>
        columnOf(target, definition, column)
      ),
    };
  }

  const definition = relation.target;
  const union = unionOf.get(definition) as Union;
  const lists = memberToColumns(field, union.alias, definition, relation.to);
  const members = Object.fromEntries(
    Object.entries(lists).map(([alias, columns]) => [
      alias,
      columns.map((column) =>
        columnOf(union.getMember(alias), definition.members[alias] as AnyTableDefinition, column)
      ),
    ])
  );

  let discriminator: AnyColumn | ComputedDiscriminator | undefined;

  if (relation.type === Relation.BELONGS_TO) {
    // Without a stored discriminator, the member is the first one holding the key.
    discriminator = relation.discriminator
      ? columnOf(source, entry.source, relation.discriminator)
      : computed(union, from, members);
  }

  return { ...base, kind: "union", target: union, members, discriminator };
}

/**
 * Sets every reference the relations imply, on the foreign key, as in SQL:
 *
 * - a belongs-to: on each `from` column, pointing at the paired `to` — or, to a union, at the
 *   member its discriminator names;
 * - a has-many / has-one: on each `to` column — every member's, to a union — pointing at `from`;
 * - a has-many / has-one declared on a union: one union reference on each `to` column, since it
 *   holds a key of whichever member its row points at. Linked last, so a belongs-to back over
 *   the same key — with its stored discriminator — is found and shared.
 */
function linkReferences(relations: readonly RuntimeRelation[], computed: ComputedDiscriminators) {
  const fromUnions = new Map<Union, Map<string, TableRelation[]>>();

  for (const relation of relations) {
    const via = relation;
    const belongsTo = relation.type === Relation.BELONGS_TO;

    if (relation.kind === "union") {
      for (const [index, from] of relation.from.entries()) {
        if (belongsTo) {
          from._addReference({
            kind: "union",
            union: relation.target,
            members: Object.fromEntries(
              Object.entries(relation.members).map(([alias, columns]) => [alias, columns[index]])
            ),
            discriminator: relation.discriminator as AnyColumn | ComputedDiscriminator,
            via,
          });
          continue;
        }

        for (const to of Object.values(relation.members)) {
          to[index]._addReference({ kind: "table", column: from, via });
        }
      }

      continue;
    }

    if (!belongsTo && relation.declaredOn instanceof Union) {
      const byField = fromUnions.get(relation.declaredOn) ?? new Map<string, TableRelation[]>();
      byField.set(relation.field, [...(byField.get(relation.field) ?? []), relation]);
      fromUnions.set(relation.declaredOn, byField);
      continue;
    }

    for (const [index, from] of relation.from.entries()) {
      const to = relation.to[index];

      if (belongsTo) {
        from._addReference({ kind: "table", column: to, via });
      } else {
        to._addReference({ kind: "table", column: from, via });
      }
    }
  }

  for (const [union, byField] of fromUnions) {
    for (const copies of byField.values()) {
      const [first] = copies;
      const keys = first.to;
      const pairs = Object.fromEntries(copies.map((copy) => [copy.source.alias, copy.from]));
      const back = keys[0].references.find(
        (reference) =>
          reference.kind === "union" &&
          reference.union === union &&
          union.memberAliases.every((alias) => reference.members[alias] === pairs[alias][0])
      );
      const discriminator =
        back?.kind === "union" ? back.discriminator : computed(union, keys, pairs);

      for (const [index, key] of keys.entries()) {
        key._addReference({
          kind: "union",
          union,
          members: Object.fromEntries(
            Object.entries(pairs).map(([alias, columns]) => [alias, columns[index]])
          ),
          discriminator,
          via: first,
        });
      }
    }
  }
}
