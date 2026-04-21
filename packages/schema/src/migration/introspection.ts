import { sql } from "@dsqlbase/core";

export const SYSTEM_SCHEMAS = ["pg_catalog", "pg_toast", "information_schema", "sys"];

const schemas = sql`
  schema_defs AS (
    SELECT json_build_object(
      'kind', 'SCHEMA',
      'name', s.name,
      'schema', s.name
    ) AS defs
    FROM schemas s
    WHERE s.name != 'public'
  )
`;

const columns = sql`
  SELECT json_agg(json_build_object(
    'kind', 'COLUMN',
    'name', a.attname,
    'dataType', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'notNull', a.attnotnull,
    'primaryKey', COALESCE((
      SELECT true
      FROM pg_constraint con
      WHERE con.conrelid = c.oid
        AND con.contype = 'p'
        AND a.attnum = ANY(con.conkey)
    ), false),
    'unique', COALESCE((
      SELECT true
      FROM pg_constraint con
      WHERE con.conrelid = c.oid
        AND con.contype = 'u'
        AND con.conkey = ARRAY[a.attnum]::smallint[]
    ), false),
    'defaultValue', (
      SELECT pg_get_expr(d.adbin, d.adrelid)
      FROM pg_attrdef d
      WHERE d.adrelid = c.oid AND d.adnum = a.attnum
    ),
    'check', (
      SELECT json_build_object(
        'kind', 'CHECK_CONSTRAINT',
        'name', con.conname,
        'expression', pg_get_constraintdef(con.oid, true)
      )
      FROM pg_constraint con
      WHERE con.conrelid = c.oid
      AND con.contype = 'c'
      AND con.conkey = ARRAY[a.attnum]::smallint[]
    ),
    'domain', (
      SELECT json_build_object(
        'kind', 'REFERENCE',
        'name', t.typname
      )
      FROM pg_type t
      WHERE t.oid = a.atttypid AND t.typtype = 'd'
    )
  ))
  FROM pg_attribute a
  WHERE a.attrelid = c.oid
    AND a.attnum > 0
    AND NOT a.attisdropped
`;

const indexes = sql`
  SELECT json_agg(json_build_object(
    'kind', 'INDEX',
    'name', ic.relname,
    'unique', ix.indisunique,
    'distinctNulls', NOT ix.indnullsnotdistinct,
    'statement', pg_get_indexdef(ic.relname::regclass),
    'columns', (
      SELECT json_agg(
        json_build_object(
          'kind', 'INDEX_COLUMN',
          'column', pa.attname,
          'sortDirection', CASE
            WHEN (ix.indoption[col_pos] & 1) = 1 THEN 'DESC'
            ELSE 'ASC'
          END,
          'nulls', CASE
            WHEN (ix.indoption[col_pos] & 2) = 2 THEN 'FIRST'
            ELSE 'LAST'
          END,
        )
        ORDER BY col_pos
      )
      FROM LATERAL unnest(ix.indkey) WITH ORDINALITY AS u(attnum, col_pos)
      JOIN pg_attribute pa
        ON pa.attrelid = c.oid
       AND pa.attnum = u.attnum
      WHERE col_pos <= ix.indnkeyatts
    ),
    'include', (
      SELECT json_agg(
        pa.attname
        ORDER BY col_pos
      )
      FROM LATERAL unnest(ix.indkey) WITH ORDINALITY AS u(attnum, col_pos)
      JOIN pg_attribute pa
        ON pa.attrelid = c.oid
       AND pa.attnum = u.attnum
      WHERE col_pos > ix.indnkeyatts
    )
  ))
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  WHERE ix.indrelid = c.oid
    AND NOT ix.indisprimary
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      WHERE con.conindid = ix.indexrelid
        AND con.contype = 'u'
    )
`;

const tables = sql`
  table_defs AS (
    SELECT json_build_object(
      'kind', 'TABLE',
      'name', c.relname,
      'schema', s.name,
      'columns', (${columns}),
      'indexes', (${indexes}),
      -- Unique constraints (multi-column unique constraints that are not represented as separate indexes)
      'unique', (
        SELECT json_agg(json_build_object(
          'name', con.conname,
          'columns', (
            -- SELECT json_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
            SELECT json_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
            FROM pg_attribute a
            WHERE a.attrelid = con.conrelid
              AND a.attnum = ANY(con.conkey)
          )
        ))
        FROM pg_constraint con
        WHERE con.conrelid = c.oid
          AND con.contype = 'u'
          AND array_length(con.conkey, 1) > 1
      ),
      -- Check constraints
      'checks', (
        SELECT json_agg(json_build_object(
          'kind', 'CHECK_CONSTRAINT',
          'constraint', con.conname,
          'check', pg_get_constraintdef(con.oid, true)
        ))
        FROM pg_constraint con
        WHERE con.conrelid = c.oid
          AND con.contype = 'c'
          AND array_length(con.conkey, 1) > 1
      )
    ) AS defs
    FROM pg_class c
    JOIN schemas s ON s.oid = c.relnamespace
    WHERE c.relkind = 'r'
  )
`;

const domains = sql`
  domain_defs AS (
    SELECT json_build_object(
      'kind', 'DOMAIN',
      'name', t.typname,
      'schema', s.name,
      'dataType', pg_catalog.format_type(t.typbasetype, t.typtypmod),
      'notNull', t.typnotnull,
      'defaultValue', t.typdefault,
      'check', (
        SELECT json_build_object(
          'kind', 'CHECK_CONSTRAINT',
          'name', con.conname,
          'expression', pg_get_constraintdef(con.oid, true)
        )
        FROM pg_constraint con
        WHERE con.contypid = t.oid AND con.contype = 'c'
        LIMIT 1
      )
    ) AS defs
    FROM pg_type t
    JOIN schemas s ON s.oid = t.typnamespace
    WHERE t.typtype = 'd'
  )
`;

const sequences = sql`
  sequence_defs AS (
    SELECT json_build_object(
      'kind', 'SEQUENCE',
      'name', c.relname,
      'schema', s.name,
      'dataType', pg_catalog.format_type(seq.seqtypid, NULL),
      'startValue', seq.seqstart::text,
      'minValue', seq.seqmin::text,
      'maxValue', seq.seqmax::text,
      'increment', seq.seqincrement::text,
      'cycle', seq.seqcycle,
      'cache', seq.seqcache::text
    ) AS defs
    FROM pg_sequence seq
    JOIN pg_class c ON c.oid = seq.seqrelid
    JOIN schemas s ON s.oid = c.relnamespace
  )
`;

const views = sql`
  view_defs AS (
    SELECT json_build_object(
      'kind', 'VIEW',
      'name', c.relname,
      'schema', s.name
    ) AS defs
    FROM pg_class c
    JOIN schemas s ON s.oid = c.relnamespace
    WHERE c.relkind = 'v'
  )
`;

const functions = sql`
  function_defs AS (
    SELECT json_build_object(
      'kind', 'FUNCTION',
      'name', p.proname,
      'schema', s.name
    ) AS defs
    FROM pg_proc p
    JOIN schemas s ON s.oid = p.pronamespace
    WHERE p.prokind = 'f'
  )
`;

export const introspection = sql`
  WITH schemas AS (
    SELECT n.oid, n.nspname AS name
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema', 'sys')
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT LIKE 'pg_toast_temp_%'
  ),
  ${schemas},
  ${tables},
  ${domains},
  ${sequences},
  ${views},
  ${functions}
  -- Concatenate all definitions into a single array
  SELECT json_agg(d.defs) AS definitions
  FROM (
    SELECT defs FROM schema_defs UNION ALL
    SELECT defs FROM table_defs UNION ALL
    SELECT defs FROM domain_defs UNION ALL
    SELECT defs FROM sequence_defs UNION ALL
    SELECT defs FROM view_defs UNION ALL
    SELECT defs FROM function_defs
  ) d
`;
