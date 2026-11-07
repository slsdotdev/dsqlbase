import {
  AnyColumnDefinition,
  AnyFieldRelation,
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
import { validateReferences } from "./references.js";

/**
 * Checks a schema definition, throwing on the first problem. Pure: it reads definitions only,
 * builds nothing, and keeps nothing — a schema it accepts can be built without further checks.
 *
 * - every union is keyed by an alias no table uses, and lists each member under the alias the
 *   schema exports it as;
 * - every relation's pairs line up, carry the same column hooks, its discriminator is where one
 *   belongs, and its field name is free on the table that gets it — including each member of a
 *   union it is declared on;
 * - no column's references form a ring, and a column with hooks references one target, reached
 *   in every union member through a unique key.
 */
export function validateSchema(schema: DefinitionSchema): void {
  const index = indexSchema(schema);

  validateUnions(schema, index);

  for (const relation of index.relations) {
    validateRelation(relation, index);
  }

  validateReferences(index.relations, referenceIndex(index), (entry) => {
    const union = entry.relation.target as AnyUnionDefinition;
    const alias = [...index.unions].find(([, candidate]) => candidate === union)?.[0] ?? "";

    return memberToColumns(entry.field, alias, union, entry.relation.to);
  });
}

function referenceIndex(index: SchemaIndex) {
  const owners = new Map<AnyColumnDefinition, AnyTableDefinition>();

  for (const table of index.tables.values()) {
    for (const column of Object.values<AnyColumnDefinition>(table.columns)) {
      owners.set(column, table);
    }
  }

  return {
    aliases: new Map([...index.tables].map(([alias, table]) => [table, alias])),
    unions: new Map([...index.unions].map(([alias, union]) => [union, alias])),
    owners,
  };
}

/** A relation as some table receives it: declared on that table, or on a union it is in. */
export type SourcedRelation = {
  readonly field: string;
  readonly relation: AnyFieldRelation;
  /** The table that has the relation. */
  readonly source: AnyTableDefinition;
  /** The union it was declared on, for a relation whose source is a union. */
  readonly union?: AnyUnionDefinition;
  /** That union's member alias for `source`. */
  readonly member?: string;
};

type SchemaIndex = {
  readonly tables: ReadonlyMap<string, AnyTableDefinition>; // alias → definition
  readonly unions: ReadonlyMap<string, AnyUnionDefinition>; // alias → definition
  readonly relations: readonly SourcedRelation[];
};

/**
 * Every relation in the schema as the table that has it sees it, in declaration order. A
 * relation declared on a union appears once per member, with `from` resolved to that member's
 * columns. Throws on a name a table receives twice.
 */
export function collectRelations(schema: DefinitionSchema): SourcedRelation[] {
  const relations: SourcedRelation[] = [];
  const names = new Map<AnyTableDefinition, Map<string, SourcedRelation>>();

  const add = (entry: SourcedRelation) => {
    const byName = names.get(entry.source) ?? new Map<string, SourcedRelation>();
    const existing = byName.get(entry.field);

    if (existing) {
      const fromUnion = entry.union ?? existing.union;

      throw new Error(
        fromUnion && entry.union !== existing.union
          ? `Relation "${entry.field}" on ${fromUnion.name} has the same name as relation ` +
              `"${entry.field}" on its member "${(entry.union ? entry.member : existing.member) as string}".`
          : `Duplicate relation name: ${entry.field}`
      );
    }

    byName.set(entry.field, entry);
    names.set(entry.source, byName);
    relations.push(entry);
  };

  for (const node of Object.values(schema)) {
    if (!(node instanceof RelationsDefinition)) {
      continue;
    }

    const declared = node.relations as AnyTableRelations;

    if (node.table instanceof UnionDefinition) {
      const union = node.table;

      for (const [field, relation] of Object.entries(declared)) {
        validateUnionSource(union, field, relation);

        for (const [member, source] of Object.entries<AnyTableDefinition>(union.members)) {
          add({
            field,
            source,
            union,
            member,
            relation: {
              ...relation,
              from: (relation.from as unknown as AnyUnionColumnDefinition[]).map(
                (column) => column.members[member]
              ),
            } as AnyFieldRelation,
          });
        }
      }

      continue;
    }

    for (const [field, relation] of Object.entries(declared)) {
      add({ field, relation, source: node.table as AnyTableDefinition });
    }
  }

  return relations;
}

function indexSchema(schema: DefinitionSchema): SchemaIndex {
  const tables = new Map<string, AnyTableDefinition>();
  const unions = new Map<string, AnyUnionDefinition>();

  for (const [alias, node] of Object.entries(schema)) {
    if (node instanceof TableDefinition) {
      tables.set(alias, node);
    } else if (node instanceof UnionDefinition) {
      unions.set(alias, node);
    }
  }

  return { tables, unions, relations: collectRelations(schema) };
}

/**
 * A union and a table are both read through the client by name — a table by alias or database
 * name — so a union's alias can only mean one of them; and a member is keyed by the alias it is exported under, which is what makes a
 * member key mean the same thing as `$$meta.key` and a node key.
 */
function validateUnions(schema: DefinitionSchema, index: SchemaIndex): void {
  for (const [alias, union] of index.unions) {
    // The client addresses a table by alias or by database name.
    if (index.tables.has(alias) || [...index.tables.values()].some((t) => t.name === alias)) {
      throw new Error(
        `Union "${alias}" has the same name as a table in the schema. A union and a table ` +
          `are both read through the client by that name, so it can only mean one of them.`
      );
    }

    for (const [key, member] of Object.entries<AnyTableDefinition>(union.members)) {
      if (schema[key] !== member) {
        throw new Error(
          `Union "${alias}" lists table "${member.name}" under "${key}", but the schema does ` +
            `not export that table as "${key}". Union members are keyed by their schema alias.`
        );
      }
    }
  }
}

/** A relation declared on a union: its `from` names the union's fields, and it targets a table. */
function validateUnionSource(
  union: AnyUnionDefinition,
  field: string,
  relation: AnyFieldRelation
): void {
  const label = `Relation "${field}" on ${union.name}`;

  if (!(relation.target instanceof TableDefinition)) {
    throw new Error(
      `${label} targets a union. A relation whose source is a union must target a table.`
    );
  }

  if (relation.discriminator) {
    throw new Error(`${label} declares a discriminator, but only a belongs-to a union needs one.`);
  }

  for (const column of relation.from as unknown[]) {
    if (!(column instanceof UnionColumnDefinition) || union.columns[column.name] !== column) {
      throw new Error(
        `${label}: a "from" column must be a field the union declares (\`union.columns.<field>\`).`
      );
    }
  }
}

/**
 * The field alias a column is declared under on `table`, or `undefined` when the column does
 * not belong to it. Identity, not name: a column from a different table that happens to share a
 * name is not a match, which is the copy-paste mistake this catches.
 */
export function findColumnAlias(
  table: AnyTableDefinition,
  column: AnyColumnDefinition
): string | undefined {
  return Object.entries(table.columns).find(([, candidate]) => candidate === column)?.[0];
}

function isTableInSchema(index: SchemaIndex, table: AnyTableDefinition): boolean {
  return [...index.tables.values()].includes(table);
}

/**
 * Checks that a relation's column pairs line up: equal, non-zero length; each column declared
 * on the side it is listed under, and not deprecated; both columns of a pair of the same type.
 * The query builder correlates over every pair, so a malformed relation would otherwise surface
 * as a confusing SQL error at query time, or not at all.
 */
function validateRelation(entry: SourcedRelation, index: SchemaIndex): void {
  const { field, relation, source, union } = entry;
  const sourceName = source.name;
  const label = union
    ? `Relation "${field}" on ${union.name} (member table "${sourceName}")`
    : `Relation "${field}" on table "${sourceName}"`;

  if (!isTableInSchema(index, source)) {
    throw new Error(`Table not found for relations: ${sourceName}`);
  }

  // Columns and relations share one namespace: the client addresses both as fields of the same
  // model (`select`, `join`, and the keys of a result row), so a name can only mean one of them.
  const column = source.columns[field];

  if (column && !column["_deprecated"]) {
    throw new Error(
      `Relation "${field}" on table "${sourceName}" collides with a column of the same ` +
        `name. Columns and relations share one field namespace on a table.`
    );
  }

  // That one namespace also excludes the names the runtime writes onto result rows.
  if (RESERVED_FIELD_NAMES.includes(field)) {
    throw new Error(
      `Table "${sourceName}" declares a relation named "${field}", which is reserved. ` +
        `The runtime writes ${RESERVED_FIELD_NAMES.join(" and ")} onto every result row.`
    );
  }

  const { from } = relation;

  if (from.length === 0) {
    throw new Error(`${label} must declare at least one column pair in "from" and "to".`);
  }

  if (relation.target instanceof UnionDefinition) {
    validateUnionTarget(label, relation, source, index);
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

  const target = relation.target;

  if (!isTableInSchema(index, target)) {
    throw new Error(`${label} targets table "${target.name}", which is not in the schema.`);
  }

  for (const [position, fromColumn] of from.entries()) {
    validatePair(label, source, fromColumn, target, to[position], `target table "${target.name}"`);
  }
}

/** One pair: each column declared, and live, on its side; both of one type, with one set of hooks. */
function validatePair(
  label: string,
  source: AnyTableDefinition,
  fromColumn: AnyColumnDefinition,
  target: AnyTableDefinition,
  toColumn: AnyColumnDefinition,
  targetLabel: string
): void {
  const fromAlias = findColumnAlias(source, fromColumn);
  const toAlias = findColumnAlias(target, toColumn);

  if (!fromAlias) {
    throw new Error(
      `${label}: "from" column "${fromColumn.name}" is not declared on table "${source.name}".`
    );
  }

  if (!toAlias) {
    throw new Error(`${label}: "to" column "${toColumn.name}" is not declared on ${targetLabel}.`);
  }

  for (const [table, alias, column] of [
    [source, fromAlias, fromColumn],
    [target, toAlias, toColumn],
  ] as const) {
    if (column["_deprecated"]) {
      throw new Error(
        `${label}: "${table.name}"."${alias}" is deprecated, so the client cannot read it.`
      );
    }
  }

  const fromType = fromColumn["_dataType"];
  const toType = toColumn["_dataType"];

  if (fromType !== toType) {
    throw new Error(
      `${label}: "${source.name}"."${fromAlias}" is "${fromType}" but ` +
        `"${target.name}"."${toAlias}" is "${toType}"; ` +
        `both columns of a pair must have the same type.`
    );
  }

  // A value crosses the relation as it is read and written: through the same hooks on both sides.
  if (fromColumn["_hooks"] !== toColumn["_hooks"]) {
    throw new Error(
      `${label} pairs "${source.name}"."${fromAlias}" and "${target.name}"."${toAlias}", but ` +
        `they carry different column hooks — a guid() and a plain column, say. Both sides of ` +
        `a pair must read and write their values the same way.`
    );
  }
}

/**
 * The union half of {@link validateRelation}: the union must be in the schema, `to` must name a
 * column on every member — through a shared field or a per-member list — paired with `from` by
 * type, and only a belongs-to may carry a discriminator.
 */
function validateUnionTarget(
  label: string,
  relation: AnyFieldRelation,
  source: AnyTableDefinition,
  index: SchemaIndex
): void {
  const target = relation.target as AnyUnionDefinition;
  const alias = [...index.unions].find(([, candidate]) => candidate === target)?.[0];

  if (!alias) {
    throw new Error(`${label} targets ${target.name}, which is not in the schema.`);
  }

  const { from } = relation;

  for (const [member, to] of Object.entries(memberToColumns(label, alias, target, relation.to))) {
    if (to.length !== from.length) {
      throw new Error(
        `${label} pairs ${from.length} "from" column(s) with ${to.length} "to" column(s) on ` +
          `member "${member}"; the two sides must have the same length.`
      );
    }

    const memberTable = target.members[member] as AnyTableDefinition;

    for (const [position, toColumn] of to.entries()) {
      validatePair(
        label,
        source,
        from[position],
        memberTable,
        toColumn,
        `member "${member}" of union "${alias}"`
      );
    }
  }

  validateDiscriminator(label, relation, source, alias);
}

/** `to` as one column-definition list per member, whichever form it was written in. */
export function memberToColumns(
  label: string,
  alias: string,
  union: AnyUnionDefinition,
  to: AnyFieldRelation["to"]
): Record<string, AnyColumnDefinition[]> {
  const members = Object.keys(union.members);

  if (Array.isArray(to)) {
    if (to.length === 0) {
      throw new Error(`${label} must declare at least one column pair in "from" and "to".`);
    }

    return Object.fromEntries(
      members.map((member) => [
        member,
        (to as unknown[]).map((column) => {
          if (!(column instanceof UnionColumnDefinition) || union.columns[column.name] !== column) {
            throw new Error(
              `${label}: a "to" column given as a list must be a shared field of union ` +
                `"${alias}" (\`${alias}.columns.<field>\`). To name a different column per ` +
                `member, pass one list per member instead.`
            );
          }

          return column.members[member];
        }),
      ])
    );
  }

  const lists = to as Record<string, AnyColumnDefinition[]>;
  const given = Object.keys(lists);
  const missing = members.filter((member) => !given.includes(member));
  const unknown = given.filter((member) => !members.includes(member));

  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `${label} must name one "to" column list per member of union "${alias}" ` +
        `(${members.join(", ")})` +
        (missing.length > 0 ? `; missing: ${missing.join(", ")}` : "") +
        (unknown.length > 0 ? `; not members: ${unknown.join(", ")}` : "") +
        `.`
    );
  }

  return lists;
}

/**
 * A belongs-to a union may store which member it points at in a column of its own — the
 * discriminator, holding a member alias. Without one, the member is the first holding the key,
 * computed when the query runs. Has-many and has-one to a union need none, since the key lives
 * on each member, so one there is a mistake.
 */
function validateDiscriminator(
  label: string,
  relation: AnyFieldRelation,
  source: AnyTableDefinition,
  union: string
): void {
  const { discriminator } = relation;

  if (relation.type !== Relation.BELONGS_TO) {
    if (discriminator) {
      throw new Error(
        `${label} declares a discriminator, but only a belongs-to a union needs one: the ` +
          `members of "${union}" hold the key.`
      );
    }

    return;
  }

  if (!discriminator) {
    return;
  }

  const alias = findColumnAlias(source, discriminator);

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
