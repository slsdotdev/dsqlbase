import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, TestClient } from "../client/index.js";
import * as schema from "../schema/schema.js";
import { Kind } from "@dsqlbase/core";
import { introspectionQuery } from "@dsqlbase/schema/migrations";

// ---------------------------------------------------------------------------
// Type normalizer
// ---------------------------------------------------------------------------

/**
 * Maps PostgreSQL canonical type names (from `pg_catalog.format_type()`)
 * back to the dataType strings used by our column factory functions.
 *
 * e.g. "character varying(100)" -> "varchar(100)", "integer" -> "int"
 */
function normalizeType(pgType: string): string {
  const varcharMatch = pgType.match(/^character varying\((\d+)\)$/);
  if (varcharMatch) return `varchar(${varcharMatch[1]})`;

  const charMatch = pgType.match(/^character\((\d+)\)$/);
  if (charMatch) return `char(${charMatch[1]})`;

  const typeMap: Record<string, string> = {
    uuid: "UUID",
    text: "text",
    boolean: "boolean",
    integer: "int",
    bigint: "bigint",
    smallint: "smallint",
    real: "real",
    "double precision": "double precision",
    numeric: "numeric",
    date: "date",
    bytea: "bytea",
    interval: "interval",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamp with time zone",
    "time without time zone": "time",
    "time with time zone": "time with time zone",
  };

  return typeMap[pgType] ?? pgType;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Wraps a string in our { kind: "SQL", text, params } shape */
function sqlNode(text: string) {
  return { kind: Kind.SQL, text, params: [] };
}

// ---------------------------------------------------------------------------
// Raw introspection types
// ---------------------------------------------------------------------------

/** System schemas that are always excluded from introspection */
const SYSTEM_SCHEMAS = ["pg_catalog", "pg_toast", "information_schema", "sys"];

interface RawColumn {
  name: string;
  type: string;
  not_null: boolean;
  primary_key: boolean;
  is_unique: boolean;
  default_value: string | null;
  check_expr: string | null;
  check_name: string | null;
}

interface RawIndex {
  name: string;
  is_unique: boolean;
  columns: string[];
}

interface RawUniqueConstraint {
  columns: string[];
}

interface RawDefinition {
  kind: string;
  name: string;
  schema_name: string;
  // Table fields
  columns?: RawColumn[];
  indexes?: RawIndex[];
  unique_constraints?: RawUniqueConstraint[] | null;
  check_constraints?: { name: string; expr: string }[] | null;
  // Domain fields
  data_type?: string;
  not_null?: boolean;
  default_value?: string | null;
  check_expr?: string | null;
  constraint_name?: string | null;
  // Sequence fields
  start_value?: string;
  min_value?: string;
  max_value?: string;
  increment?: string;
  cycle?: boolean;
  cache?: string;
}

// ---------------------------------------------------------------------------
// Schema shape builders
// ---------------------------------------------------------------------------

function buildColumn(raw: RawColumn) {
  return {
    kind: Kind.COLUMN,
    name: raw.name,
    dataType: normalizeType(raw.type),
    notNull: raw.not_null,
    primaryKey: raw.primary_key,
    unique: raw.is_unique,
    defaultValue: raw.default_value ? sqlNode(raw.default_value) : undefined,
    check: raw.check_expr ? sqlNode(raw.check_expr) : undefined,
    constraint: raw.check_name ?? undefined,
    domain: undefined,
  };
}

function buildIndex(raw: RawIndex) {
  return {
    kind: Kind.INDEX,
    name: raw.name,
    unique: raw.is_unique,
    nullsDistinct: undefined,
    columns: raw.columns.map((colName) => ({
      kind: Kind.INDEX_COLUMN,
      name: `${raw.name}_column_${colName}`,
      column: sqlNode(`"${colName}"`),
      nulls: undefined,
    })),
    include: undefined,
  };
}

function buildSchema(raw: RawDefinition) {
  return {
    kind: Kind.SCHEMA,
    name: raw.name,
  };
}

function buildTable(raw: RawDefinition) {
  return {
    kind: Kind.TABLE,
    name: raw.name,
    schema: raw.schema_name === "public" ? undefined : { kind: Kind.SCHEMA, name: raw.schema_name },
    columns: (raw.columns ?? []).map(buildColumn),
    indexes: (raw.indexes ?? []).map(buildIndex),
    checks: raw.check_constraints?.map((c) => sqlNode(c.expr)) ?? undefined,
    unique:
      raw.unique_constraints?.map((uc) => uc.columns.map((col) => sqlNode(`"${col}"`))) ??
      undefined,
  };
}

function buildDomain(raw: RawDefinition) {
  return {
    kind: Kind.DOMAIN,
    name: raw.name,
    dataType: normalizeType(raw.data_type ?? "text"),
    notNull: raw.not_null ?? false,
    constraint: raw.constraint_name ?? undefined,
    defaultValue: raw.default_value ? sqlNode(raw.default_value) : undefined,
    check: raw.check_expr ? sqlNode(raw.check_expr) : undefined,
  };
}

function buildSequence(raw: RawDefinition) {
  return {
    kind: Kind.SEQUENCE,
    name: raw.name,
    dataType: normalizeType(raw.data_type ?? "bigint"),
    cache: Number(raw.cache),
    cycle: raw.cycle ?? false,
    increment: Number(raw.increment),
    minValue: Number(raw.min_value),
    maxValue: Number(raw.max_value),
    startValue: Number(raw.start_value),
    ownedBy: undefined,
  };
}

function buildView(raw: RawDefinition) {
  return {
    kind: Kind.VIEW,
    name: raw.name,
  };
}

function buildFunction(raw: RawDefinition) {
  return {
    kind: Kind.FUNCTION,
    name: raw.name,
  };
}

const builders: Record<string, (raw: RawDefinition) => Record<string, unknown>> = {
  [Kind.SCHEMA]: buildSchema,
  [Kind.TABLE]: buildTable,
  [Kind.DOMAIN]: buildDomain,
  [Kind.SEQUENCE]: buildSequence,
  [Kind.VIEW]: buildView,
  [Kind.FUNCTION]: buildFunction,
};

// ---------------------------------------------------------------------------
// Introspection query
// ---------------------------------------------------------------------------

/**
 * Introspects the database and returns all definitions as a flat array.
 *
 * Uses CTEs to:
 * 1. Discover non-system schemas
 * 2. Fetch tables (with columns, indexes, constraints) across those schemas
 * 3. Fetch domains, sequences, views, and functions across those schemas
 * 4. Tag each result with its `kind` and concatenate into a `definitions` array
 */
async function introspect(pg: TestClient["pg"]) {
  const result = await pg.sql<{ definitions: RawDefinition[] }>`
    WITH schemas AS (
      SELECT n.oid, n.nspname AS name
      FROM pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema', 'sys')
        AND n.nspname NOT LIKE 'pg_temp_%'
        AND n.nspname NOT LIKE 'pg_toast_temp_%'
    ),
    -- Schema definitions
    schema_defs AS (
      SELECT json_build_object(
        'kind', 'SCHEMA',
        'name', s.name,
        'schema_name', s.name
      ) AS definition
      FROM schemas s
      WHERE s.name != 'public'
    ),
    -- Table definitions with columns, indexes, and constraints
    table_defs AS (
      SELECT json_build_object(
        'kind', 'TABLE',
        'name', c.relname,
        'schema_name', s.name,
        -- Columns with their properties and constraints
        'columns', (
          SELECT json_agg(col ORDER BY col.attnum)
          FROM (
            SELECT
              a.attnum,
              a.attname AS name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS not_null,
              COALESCE((
                SELECT true
                FROM pg_constraint con
                WHERE con.conrelid = c.oid
                  AND con.contype = 'p'
                  AND a.attnum = ANY(con.conkey)
              ), false) AS primary_key,
              COALESCE((
                SELECT true
                FROM pg_constraint con
                WHERE con.conrelid = c.oid
                  AND con.contype = 'u'
                  AND con.conkey = ARRAY[a.attnum]::smallint[]
              ), false) AS is_unique,
              (
                SELECT pg_get_expr(d.adbin, d.adrelid)
                FROM pg_attrdef d
                WHERE d.adrelid = c.oid AND d.adnum = a.attnum
              ) AS default_value,
              (
                SELECT pg_get_constraintdef(con.oid)
                FROM pg_constraint con
                WHERE con.conrelid = c.oid
                  AND con.contype = 'c'
                  AND con.conkey = ARRAY[a.attnum]::smallint[]
              ) AS check_expr,
              (
                SELECT con.conname
                FROM pg_constraint con
                WHERE con.conrelid = c.oid
                  AND con.contype = 'c'
                  AND con.conkey = ARRAY[a.attnum]::smallint[]
              ) AS check_name
            FROM pg_attribute a
            WHERE a.attrelid = c.oid
              AND a.attnum > 0
              AND NOT a.attisdropped
          ) col
        ),
        -- Indexes (excluding primary keys and unique constraints, which are handled separately)
        'indexes', (
          SELECT json_agg(idx ORDER BY idx.name)
          FROM (
            SELECT
              ic.relname AS name,
              ix.indisunique AS is_unique,
              (
                SELECT json_agg(pa.attname ORDER BY array_position(ix.indkey, pa.attnum))
                FROM pg_attribute pa
                WHERE pa.attrelid = c.oid
                  AND pa.attnum = ANY(ix.indkey)
              ) AS columns
            FROM pg_index ix
            JOIN pg_class ic ON ic.oid = ix.indexrelid
            WHERE ix.indrelid = c.oid
              AND NOT ix.indisprimary
              AND NOT EXISTS (
                SELECT 1 FROM pg_constraint con
                WHERE con.conindid = ix.indexrelid
                  AND con.contype = 'u'
              )
          ) idx
        ),
        -- Unique constraints (multi-column unique constraints that are not represented as separate indexes)
        'unique_constraints', (
          SELECT json_agg(uc)
          FROM (
            SELECT
              (
                SELECT json_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
                FROM pg_attribute a
                WHERE a.attrelid = con.conrelid
                  AND a.attnum = ANY(con.conkey)
              ) AS columns
            FROM pg_constraint con
            WHERE con.conrelid = c.oid
              AND con.contype = 'u'
              AND array_length(con.conkey, 1) > 1
          ) uc
        ),
        -- Check constraints
        'check_constraints', (
          SELECT json_agg(json_build_object(
            'name', con.conname,
            'expr', pg_get_constraintdef(con.oid)
          ))
          FROM pg_constraint con
          WHERE con.conrelid = c.oid
            AND con.contype = 'c'
            AND array_length(con.conkey, 1) > 1
        )
      ) AS definition
      FROM pg_class c
      JOIN schemas s ON s.oid = c.relnamespace
      WHERE c.relkind = 'r'
    ),
    -- Domain definitions
    domain_defs AS (
      SELECT json_build_object(
        'kind', 'DOMAIN',
        'name', t.typname,
        'schema_name', s.name,
        'data_type', pg_catalog.format_type(t.typbasetype, t.typtypmod),
        'not_null', t.typnotnull,
        'default_value', t.typdefault,
        'check_expr', (
          SELECT pg_get_constraintdef(con.oid)
          FROM pg_constraint con
          WHERE con.contypid = t.oid AND con.contype = 'c'
          LIMIT 1
        ),
        'constraint_name', (
          SELECT con.conname
          FROM pg_constraint con
          WHERE con.contypid = t.oid AND con.contype = 'c'
          LIMIT 1
        )
      ) AS definition
      FROM pg_type t
      JOIN schemas s ON s.oid = t.typnamespace
      WHERE t.typtype = 'd'
    ),
    -- Sequence definitions
    sequence_defs AS (
      SELECT json_build_object(
        'kind', 'SEQUENCE',
        'name', c.relname,
        'schema_name', s.name,
        'data_type', pg_catalog.format_type(seq.seqtypid, NULL),
        'start_value', seq.seqstart::text,
        'min_value', seq.seqmin::text,
        'max_value', seq.seqmax::text,
        'increment', seq.seqincrement::text,
        'cycle', seq.seqcycle,
        'cache', seq.seqcache::text
      ) AS definition
      FROM pg_sequence seq
      JOIN pg_class c ON c.oid = seq.seqrelid
      JOIN schemas s ON s.oid = c.relnamespace
    ),
    -- View definitions
    view_defs AS (
      SELECT json_build_object(
        'kind', 'VIEW',
        'name', c.relname,
        'schema_name', s.name
      ) AS definition
      FROM pg_class c
      JOIN schemas s ON s.oid = c.relnamespace
      WHERE c.relkind = 'v'
    ),
    -- Function definitions
    function_defs AS (
      SELECT json_build_object(
        'kind', 'FUNCTION',
        'name', p.proname,
        'schema_name', s.name
      ) AS definition
      FROM pg_proc p
      JOIN schemas s ON s.oid = p.pronamespace
      WHERE p.prokind = 'f'
    )
    -- Concatenate all definitions into a single array
    SELECT json_agg(d.definition) AS definitions
    FROM (
      SELECT definition FROM schema_defs UNION ALL
      SELECT definition FROM table_defs UNION ALL
      SELECT definition FROM domain_defs UNION ALL
      SELECT definition FROM sequence_defs UNION ALL
      SELECT definition FROM view_defs UNION ALL
      SELECT definition FROM function_defs
    ) d
  `;

  const definitions = result.rows[0]?.definitions ?? [];
  return definitions.map((raw) => {
    const builder = builders[raw.kind];
    if (!builder) throw new Error(`Unknown definition kind: ${raw.kind}`);
    return builder(raw);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Schema introspection", () => {
  let client: TestClient;
  let definitions: Awaited<ReturnType<typeof introspect>>;

  beforeAll(async () => {
    client = await createClient();
    definitions = await introspect(client.pg);
  });

  afterAll(async () => {
    await client.close();
  });

  /** Filter definitions by kind */
  function byKind<T extends string>(kind: T) {
    return definitions.filter((d) => d.kind === kind);
  }

  // -------------------------------------------------------------------------
  // General
  // -------------------------------------------------------------------------

  it("should return all definitions in a single query", () => {
    expect(definitions.length).toBeGreaterThan(0);

    const kinds = new Set(definitions.map((d) => d.kind));
    expect(kinds).toContain(Kind.TABLE);
    expect(kinds).toContain(Kind.DOMAIN);
    expect(kinds).toContain(Kind.SEQUENCE);
    expect(kinds).toContain(Kind.VIEW);
    expect(kinds).toContain(Kind.FUNCTION);
  });

  // -------------------------------------------------------------------------
  // Schemas
  // -------------------------------------------------------------------------

  describe("Schemas", () => {
    it("should not include system schemas or public", () => {
      const schemas = byKind(Kind.SCHEMA);
      const names = schemas.map((s) => s.name);

      for (const sys of SYSTEM_SCHEMAS) {
        expect(names).not.toContain(sys);
      }
      expect(names).not.toContain("public");
    });
  });

  // -------------------------------------------------------------------------
  // Tables
  // -------------------------------------------------------------------------

  describe("Tables", () => {
    it("should introspect all tables", () => {
      const tables = byKind(Kind.TABLE);
      const tableNames = tables.map((t) => t.name).sort();

      expect(tableNames).toEqual(["projects", "tasks", "team_members", "teams", "users"]);
    });

    it("should match local schema column definitions", () => {
      const tables = byKind(Kind.TABLE) as ReturnType<typeof buildTable>[];
      const localTables = Object.values(schema)
        .filter((def) => def.kind === Kind.TABLE)
        .map((def) => def.toJSON());

      for (const localTable of localTables) {
        const dbTable = tables.find((t) => t.name === localTable.name);
        expect(dbTable, `Table "${localTable.name}" not found in DB`).toBeDefined();
        if (!dbTable) continue;

        for (const localCol of localTable.columns) {
          const dbCol = dbTable.columns.find((c) => c.name === localCol.name);
          expect(
            dbCol,
            `Column "${localTable.name}.${localCol.name}" not found in DB`
          ).toBeDefined();
          if (!dbCol) continue;

          expect(dbCol.dataType).toBe(localCol.dataType);
          expect(dbCol.notNull).toBe(localCol.notNull);
          expect(dbCol.primaryKey).toBe(localCol.primaryKey);
          expect(dbCol.unique).toBe(localCol.unique);
        }

        expect(dbTable.columns.length).toBe(localTable.columns.length);
      }
    });

    it("should match local schema index definitions", () => {
      const tables = byKind(Kind.TABLE) as ReturnType<typeof buildTable>[];
      const localTables = Object.values(schema)
        .filter((def) => def.kind === Kind.TABLE)
        .map((def) => def.toJSON());

      for (const localTable of localTables) {
        const dbTable = tables.find((t) => t.name === localTable.name);
        if (!dbTable) continue;

        const localIndexes = localTable.indexes.filter((idx) => idx.columns.length > 0);

        for (const localIdx of localIndexes) {
          const dbIdx = dbTable.indexes.find((i) => i.name === localIdx.name);
          expect(dbIdx, `Index "${localIdx.name}" not found on "${localTable.name}"`).toBeDefined();
          if (!dbIdx) continue;

          expect(dbIdx.unique).toBe(localIdx.unique);

          const localColNames = localIdx.columns.map((c) => c.column.text);
          const dbColNames = dbIdx.columns.map((c) => c.column.text);
          expect(dbColNames).toEqual(localColNames);
        }
      }
    });

    it("should detect table-level unique constraints", () => {
      const tables = byKind(Kind.TABLE) as ReturnType<typeof buildTable>[];
      const membersTable = tables.find((t) => t.name === "team_members");
      expect(membersTable).toBeDefined();

      expect(membersTable?.unique).toBeDefined();
      expect(membersTable?.unique).toHaveLength(1);
      expect(membersTable?.unique?.[0]).toEqual([sqlNode('"team_id"'), sqlNode('"user_id"')]);
    });

    it("should detect column default values", () => {
      const tables = byKind(Kind.TABLE) as ReturnType<typeof buildTable>[];
      const teamsTable = tables.find((t) => t.name === "teams");
      expect(teamsTable).toBeDefined();

      const idCol = teamsTable?.columns.find((c) => c.name === "id");
      expect(idCol?.defaultValue).toEqual(sqlNode("gen_random_uuid()"));

      const isActiveCol = teamsTable?.columns.find((c) => c.name === "is_active");
      expect(isActiveCol?.defaultValue).toEqual(sqlNode("true"));
    });

    it("should set schema to undefined for public tables", () => {
      const tables = byKind(Kind.TABLE) as ReturnType<typeof buildTable>[];
      for (const table of tables) {
        expect(table.schema).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Domains
  // -------------------------------------------------------------------------

  describe("Domains", () => {
    it("should introspect all domains", () => {
      const domains = byKind(Kind.DOMAIN);
      const domainNames = domains.map((d) => d.name).sort();

      expect(domainNames).toEqual(["priority_level", "task_status"]);
    });

    it("should introspect domain with CHECK constraint", () => {
      const domains = byKind(Kind.DOMAIN) as ReturnType<typeof buildDomain>[];
      const taskStatus = domains.find((d) => d.name === "task_status");
      expect(taskStatus).toBeDefined();

      expect(taskStatus?.kind).toBe(Kind.DOMAIN);
      expect(taskStatus?.dataType).toBe("text");
      expect(taskStatus?.notNull).toBe(true);
      expect(taskStatus?.constraint).toBe("chk_task_status");
      expect(taskStatus?.check).toBeDefined();
      expect(taskStatus?.check?.text).toContain("VALUE");
    });

    it("should introspect domain with default value", () => {
      const domains = byKind(Kind.DOMAIN) as ReturnType<typeof buildDomain>[];
      const priorityLevel = domains.find((d) => d.name === "priority_level");
      expect(priorityLevel).toBeDefined();

      expect(priorityLevel?.kind).toBe(Kind.DOMAIN);
      expect(priorityLevel?.dataType).toBe("int");
      expect(priorityLevel?.notNull).toBe(true);
      expect(priorityLevel?.defaultValue).toEqual(sqlNode("0"));
    });
  });

  // -------------------------------------------------------------------------
  // Sequences
  // -------------------------------------------------------------------------

  describe("Sequences", () => {
    it("should introspect all sequences", () => {
      const sequences = byKind(Kind.SEQUENCE);
      const seqNames = sequences.map((s) => s.name);

      expect(seqNames).toContain("task_number_seq");
    });

    it("should introspect sequence properties", () => {
      const sequences = byKind(Kind.SEQUENCE) as ReturnType<typeof buildSequence>[];
      const taskSeq = sequences.find((s) => s.name === "task_number_seq");
      expect(taskSeq).toBeDefined();

      expect(taskSeq?.kind).toBe(Kind.SEQUENCE);
      expect(taskSeq?.dataType).toBe("bigint");
      expect(taskSeq?.increment).toBe(1);
      expect(taskSeq?.startValue).toBe(1);
      expect(taskSeq?.cache).toBe(1);
      expect(taskSeq?.cycle).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  describe("Views", () => {
    it("should introspect all views", () => {
      const views = byKind(Kind.VIEW);
      const viewNames = views.map((v) => v.name);

      expect(viewNames).toContain("active_teams");
    });

    it("should return correct shape for views", () => {
      const views = byKind(Kind.VIEW) as ReturnType<typeof buildView>[];
      const activeTeams = views.find((v) => v.name === "active_teams");
      expect(activeTeams).toBeDefined();

      expect(activeTeams?.kind).toBe(Kind.VIEW);
      expect(activeTeams?.name).toBe("active_teams");
    });
  });

  // -------------------------------------------------------------------------
  // Functions
  // -------------------------------------------------------------------------

  describe("Functions", () => {
    it("should introspect all functions", () => {
      const functions = byKind(Kind.FUNCTION);
      const funcNames = functions.map((f) => f.name);

      expect(funcNames).toContain("project_count");
    });

    it("should return correct shape for functions", () => {
      const functions = byKind(Kind.FUNCTION) as ReturnType<typeof buildFunction>[];
      const projectCount = functions.find((f) => f.name === "project_count");
      expect(projectCount).toBeDefined();

      expect(projectCount?.kind).toBe(Kind.FUNCTION);
      expect(projectCount?.name).toBe("project_count");
    });
  });

  it("should run introspection query", async () => {
    const result = await client.session.execute(introspectionQuery.toQuery());
    console.dir(result, { depth: 10 });
    expect(result.length).toBeGreaterThan(0);
  });
});
