import {
  AnyColumnDefinition,
  AnyConstraintDefinition,
  AnyDomainDefinition,
  AnyIndexDefinition,
  AnySequenceDefinition,
  AnyTableDefinition,
} from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../base.js";

// ──────────────────────────────────────────────────────────────────────────
// Data type normalization
//
// pg_catalog.format_type returns long-form names ("character varying(255)",
// "integer", "timestamp without time zone") that don't match the canonical
// short-form the schema definitions emit. Each resolver decides whether it
// owns a given raw type and how to rewrite it. First match wins; the rest of
// the list is informational, with one exception called out inline.
// ──────────────────────────────────────────────────────────────────────────

type DataTypeResolver = {
  match: (raw: string) => boolean;
  resolve: (raw: string) => string;
};

const DATA_TYPE_RESOLVERS: DataTypeResolver[] = [
  // "character varying" must precede "character" — otherwise the latter regex swallows it.
  {
    match: (raw) => /^character varying(\([^)]*\))?$/.test(raw),
    resolve: (raw) => raw.replace(/^character varying/, "varchar"),
  },
  {
    match: (raw) => /^character(\([^)]*\))?$/.test(raw),
    resolve: (raw) => raw.replace(/^character/, "char"),
  },
  {
    match: (raw) => raw === "integer",
    resolve: () => "int",
  },
  {
    match: (raw) => /^timestamp without time zone(\([^)]*\))?$/.test(raw),
    resolve: (raw) => raw.replace(" without time zone", ""),
  },
  {
    match: (raw) => /^time without time zone(\([^)]*\))?$/.test(raw),
    resolve: (raw) => raw.replace(" without time zone", ""),
  },
];

function normalizeDataType(raw: string): string {
  for (const resolver of DATA_TYPE_RESOLVERS) {
    if (resolver.match(raw)) return resolver.resolve(raw);
  }
  return raw;
}

// ──────────────────────────────────────────────────────────────────────────
// Raw shapes
//
// What the introspection query produces in its JSON payload, before any
// normalization. These differ from the serialized shapes in three ways:
//   - sequence numerics arrive as `::text` strings to dodge bigint precision loss
//   - column data types use the PG long-form
//   - table constraints arrive as a single unified `pg_constraint` array, not
//     split between column-level and table-level
// ──────────────────────────────────────────────────────────────────────────

type RawSequenceOptions = {
  dataType: string | null;
  cache: string | null;
  cycle: boolean | null;
  increment: string | null;
  minValue: string | null;
  maxValue: string | null;
  startValue: string | null;
  ownedBy: string | null;
};

type RawColumn = {
  kind: "COLUMN";
  name: string;
  dataType: string;
  notNull: boolean;
  defaultValue: string | null;
  domain: string | null;
  generated: { type: "ALWAYS"; expression: string; mode: "STORED" } | null;
  identity: {
    type: "ALWAYS" | "BY DEFAULT";
    sequenceName: string;
    options: RawSequenceOptions;
  } | null;
};

type RawIndexColumn = {
  kind: "INDEX_COLUMN";
  /** `null` for an expression key. */
  column: string | null;
  expression: string | null;
  nulls: "FIRST" | "LAST";
};

type RawIndex = {
  kind: "INDEX";
  name: string;
  unique: boolean;
  valid: boolean;
  distinctNulls: boolean;
  columns: RawIndexColumn[];
  include: string[] | null;
  where: string | null;
};

type RawConstraint = {
  kind: "PRIMARY_KEY_CONSTRAINT" | "UNIQUE_CONSTRAINT" | "CHECK_CONSTRAINT";
  name: string;
  columns: string[];
  expression: string | null;
  validated: boolean;
  distinctNulls: boolean | null;
  include: string[] | null;
};

type RawSchema = {
  kind: "SCHEMA";
  name: string;
};

type RawDomain = {
  kind: "DOMAIN";
  name: string;
  namespace: string;
  dataType: string;
  notNull: boolean;
  defaultValue: string | null;
  check: { kind: "CHECK_CONSTRAINT"; name: string; expression: string } | null;
};

type RawSequence = {
  kind: "SEQUENCE";
  name: string;
  namespace: string;
  options: RawSequenceOptions;
};

type RawTable = {
  kind: "TABLE";
  name: string;
  namespace: string;
  columns: RawColumn[];
  indexes: RawIndex[] | null;
  constraints: RawConstraint[] | null;
};

type RawView = {
  kind: "VIEW";
  name: string;
  namespace: string;
};

type RawFunction = {
  kind: "FUNCTION";
  name: string;
  namespace: string;
};

export type RawSchemaObject =
  | RawSchema
  | RawDomain
  | RawSequence
  | RawTable
  | RawView
  | RawFunction;

// ──────────────────────────────────────────────────────────────────────────
// Per-kind normalizers
// ──────────────────────────────────────────────────────────────────────────

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// Columns are mutated in-flight while constraints get partitioned onto them
// (primaryKey / unique / check flags). The serialized shape is readonly thanks
// to the `as const` in toJSON, so we widen here and rely on covariance to hand
// the result back as the readonly view.
type SerializedColumn = Mutable<SerializedObject<AnyColumnDefinition>>;
type SerializedConstraint = SerializedObject<AnyConstraintDefinition>;
type SerializedIndex = SerializedObject<AnyIndexDefinition>;
type SerializedSequenceOptions = SerializedObject<AnySequenceDefinition>["options"];

function toNumber(value: string | null): number | undefined {
  return value === null ? undefined : Number(value);
}

function normalizeSequenceOptions(raw: RawSequenceOptions): SerializedSequenceOptions {
  return {
    dataType: raw.dataType ? normalizeDataType(raw.dataType) : undefined,
    cache: toNumber(raw.cache),
    cycle: raw.cycle ?? undefined,
    increment: toNumber(raw.increment),
    minValue: toNumber(raw.minValue),
    maxValue: toNumber(raw.maxValue),
    startValue: toNumber(raw.startValue),
    ownedBy: raw.ownedBy ?? undefined,
  };
}

function normalizeColumn(raw: RawColumn): SerializedColumn {
  return {
    kind: "COLUMN",
    name: raw.name,
    dataType: normalizeDataType(raw.dataType),
    notNull: raw.notNull,
    primaryKey: false,
    unique: false,
    defaultValue: raw.defaultValue,
    check: null,
    domain: raw.domain,
    generated: raw.generated,
    identity: raw.identity
      ? {
          type: raw.identity.type,
          sequenceName: raw.identity.sequenceName,
          options: normalizeSequenceOptions(raw.identity.options),
        }
      : null,
  };
}

function normalizeIndex(raw: RawIndex): SerializedIndex {
  return {
    kind: "INDEX",
    name: raw.name,
    unique: raw.unique,
    valid: raw.valid,
    distinctNulls: raw.distinctNulls,
    include: raw.include,
    where: raw.where ?? null,
    // Named as `IndexDefinition.toJSON()` names them.
    columns: raw.columns.map((col, position) =>
      col.column === null
        ? {
            kind: "INDEX_COLUMN",
            name: `${raw.name}_expression_${position}`,
            nulls: col.nulls,
            column: null,
            expression: col.expression ?? "",
          }
        : {
            kind: "INDEX_COLUMN",
            name: `${raw.name}_column_${col.column}`,
            nulls: col.nulls,
            column: col.column,
          }
    ),
  };
}

// Splits the unified pg_constraint array. A one-column PRIMARY KEY or CHECK collapses onto its
// column; everything else stays at the table level — a UNIQUE always, so its name survives.
// The diff compares constraints wherever they were declared (`diffTable`).
function partitionConstraints(
  raw: RawConstraint[],
  columnsByName: Map<string, SerializedColumn>
): SerializedConstraint[] {
  const tableLevel: SerializedConstraint[] = [];

  for (const constraint of raw) {
    const [first] = constraint.columns;
    const target = first !== undefined ? columnsByName.get(first) : undefined;
    const singleColumn = constraint.columns.length === 1 && target !== undefined;

    if (singleColumn && constraint.kind === "PRIMARY_KEY_CONSTRAINT") {
      target.primaryKey = true;
      continue;
    }

    if (singleColumn && constraint.kind === "CHECK_CONSTRAINT" && constraint.expression !== null) {
      target.check = {
        kind: "CHECK_CONSTRAINT",
        name: constraint.name,
        expression: constraint.expression,
        validated: constraint.validated,
      };
      continue;
    }

    if (constraint.kind === "CHECK_CONSTRAINT") {
      if (constraint.expression === null) continue;
      tableLevel.push({
        kind: "CHECK_CONSTRAINT",
        name: constraint.name,
        expression: constraint.expression,
        validated: constraint.validated,
      });
    } else if (constraint.kind === "UNIQUE_CONSTRAINT") {
      tableLevel.push({
        kind: "UNIQUE_CONSTRAINT",
        name: constraint.name,
        columns: constraint.columns,
        include: constraint.include,
        distinctNulls: constraint.distinctNulls,
      });
    } else {
      tableLevel.push({
        kind: "PRIMARY_KEY_CONSTRAINT",
        name: constraint.name,
        columns: constraint.columns,
        include: coversEveryOtherColumn(constraint, columnsByName) ? null : constraint.include,
      });
    }
  }

  return tableLevel;
}

// DSQL stores a table by its primary key: the key's index lists every other column as INCLUDE,
// columns added later too. Nothing declared it, so it is read as no INCLUDE at all.
function coversEveryOtherColumn(
  constraint: RawConstraint,
  columnsByName: Map<string, SerializedColumn>
): boolean {
  const include = new Set(constraint.include ?? []);
  const others = [...columnsByName.keys()].filter((name) => !constraint.columns.includes(name));

  return include.size > 0 && include.size === others.length && others.every((n) => include.has(n));
}

function normalizeTable(raw: RawTable): SerializedObject<AnyTableDefinition> {
  const columns = raw.columns.map(normalizeColumn);
  const columnsByName = new Map(columns.map((col) => [col.name, col]));
  const constraints = partitionConstraints(raw.constraints ?? [], columnsByName);
  const indexes = (raw.indexes ?? []).map(normalizeIndex);

  return {
    kind: "TABLE",
    name: raw.name,
    namespace: raw.namespace,
    columns,
    indexes,
    constraints,
  };
}

function normalizeDomain(raw: RawDomain): SerializedObject<AnyDomainDefinition> {
  return {
    kind: "DOMAIN",
    name: raw.name,
    namespace: raw.namespace,
    dataType: normalizeDataType(raw.dataType),
    notNull: raw.notNull,
    defaultValue: raw.defaultValue ?? undefined,
    // Domain constraints can't be added `NOT VALID` on DSQL: read as validated.
    check: raw.check ? { ...raw.check, validated: true } : undefined,
  };
}

function normalizeSequence(raw: RawSequence): SerializedObject<AnySequenceDefinition> {
  return {
    kind: "SEQUENCE",
    name: raw.name,
    namespace: raw.namespace,
    options: normalizeSequenceOptions(raw.options),
  };
}

export function normalizeObject(raw: RawSchemaObject): SerializedObject<SchemaObjectType> | null {
  switch (raw.kind) {
    case "SCHEMA":
      return raw;
    case "DOMAIN":
      return normalizeDomain(raw);
    case "SEQUENCE":
      return normalizeSequence(raw);
    case "TABLE":
      return normalizeTable(raw);
    // Reserved for future stories — dropped at the boundary so the introspection
    // query can keep emitting them without the rest of the pipeline knowing.
    case "VIEW":
    case "FUNCTION":
      return null;
  }
}
