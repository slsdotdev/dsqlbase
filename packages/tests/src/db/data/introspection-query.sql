
  WITH schemas AS (
    SELECT n.oid, n.nspname AS name
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema', 'sys')
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT LIKE 'pg_toast_temp_%'
  ),
  
  schema_defs AS (
    SELECT json_build_object(
      'kind', 'SCHEMA',
      'name', s.name
    ) AS defs
    FROM schemas s
    WHERE s.name != 'public'
  )
,
  
  table_defs AS (
    SELECT json_build_object(
      'kind', 'TABLE',
      'name', c.relname,
      'namespace', s.name,
      'columns', (
  SELECT json_agg(json_build_object(
    'kind', 'COLUMN',
    'name', a.attname,
    'dataType', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'notNull', a.attnotnull,
    'defaultValue', CASE WHEN a.attgenerated = '' THEN (
      SELECT pg_get_expr(d.adbin, d.adrelid)
      FROM pg_attrdef d
      WHERE d.adrelid = c.oid AND d.adnum = a.attnum
    ) ELSE NULL END,
    'domain', (
      SELECT t.typname
      FROM pg_type t
      WHERE t.oid = a.atttypid AND t.typtype = 'd'
    ),
    'generated', CASE
      WHEN a.attgenerated = 's' THEN json_build_object(
        'type', 'ALWAYS',
        'expression', (
          SELECT pg_get_expr(d.adbin, d.adrelid)
          FROM pg_attrdef d
          WHERE d.adrelid = c.oid AND d.adnum = a.attnum
        ),
        'mode', 'STORED'
      )
      ELSE NULL
    END,
    'identity', CASE
      WHEN a.attidentity IN ('a', 'd') THEN (
        SELECT json_build_object(
          'type', CASE a.attidentity WHEN 'a' THEN 'ALWAYS' ELSE 'BY DEFAULT' END,
          'sequenceName', sc.relname,
          'options', json_build_object(
            'dataType', pg_catalog.format_type(seq.seqtypid, NULL),
            'cache', seq.seqcache::text,
            'cycle', seq.seqcycle,
            'increment', seq.seqincrement::text,
            'minValue', seq.seqmin::text,
            'maxValue', seq.seqmax::text,
            'startValue', seq.seqstart::text,
            'ownedBy', NULL
          )
        )
        FROM pg_depend dep
        JOIN pg_class sc ON sc.oid = dep.objid AND sc.relkind = 'S'
        JOIN pg_sequence seq ON seq.seqrelid = sc.oid
        WHERE dep.refclassid = 'pg_class'::regclass
          AND dep.refobjid = c.oid
          AND dep.refobjsubid = a.attnum
          AND dep.deptype = 'i'
        LIMIT 1
      )
      ELSE NULL
    END
  ))
  FROM pg_attribute a
  WHERE a.attrelid = c.oid
    AND a.attnum > 0
    AND NOT a.attisdropped
),
      'indexes', (
  SELECT json_agg(json_build_object(
    'kind', 'INDEX',
    'name', ic.relname,
    'unique', ix.indisunique,
    'distinctNulls', NOT ix.indnullsnotdistinct,
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
          END
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
        AND con.contype IN ('u', 'p')
    )
),
      'constraints', (
  SELECT json_agg(json_build_object(
    'kind', CASE con.contype
      WHEN 'p' THEN 'PRIMARY_KEY_CONSTRAINT'
      WHEN 'u' THEN 'UNIQUE_CONSTRAINT'
      WHEN 'c' THEN 'CHECK_CONSTRAINT'
    END,
    'name', con.conname,
    'columns', (
      SELECT json_agg(a.attname ORDER BY array_position(con.conkey, a.attnum))
      FROM pg_attribute a
      WHERE a.attrelid = con.conrelid
        AND a.attnum = ANY(con.conkey)
    ),
    'expression', CASE WHEN con.contype = 'c'
      THEN pg_get_constraintdef(con.oid, true) ELSE NULL END,
    'distinctNulls', CASE WHEN con.contype = 'u'
      THEN NOT cix.indnullsnotdistinct ELSE NULL END,
    'include', NULL
  ))
  FROM pg_constraint con
  LEFT JOIN pg_index cix ON cix.indexrelid = con.conindid AND con.contype = 'u'
  WHERE con.conrelid = c.oid
    AND con.contype IN ('p', 'u', 'c')
)
    ) AS defs
    FROM pg_class c
    JOIN schemas s ON s.oid = c.relnamespace
    WHERE c.relkind = 'r'
  )
,
  
  domain_defs AS (
    SELECT json_build_object(
      'kind', 'DOMAIN',
      'name', t.typname,
      'namespace', s.name,
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
,
  
  sequence_defs AS (
    SELECT json_build_object(
      'kind', 'SEQUENCE',
      'name', c.relname,
      'namespace', s.name,
      'options', json_build_object(
        'dataType', pg_catalog.format_type(seq.seqtypid, NULL),
        'startValue', seq.seqstart::text,
        'minValue', seq.seqmin::text,
        'maxValue', seq.seqmax::text,
        'increment', seq.seqincrement::text,
        'cycle', seq.seqcycle,
        'cache', seq.seqcache::text,
        'ownedBy', NULL
      )
    ) AS defs
    FROM pg_sequence seq
    JOIN pg_class c ON c.oid = seq.seqrelid
    JOIN schemas s ON s.oid = c.relnamespace
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_depend dep
      WHERE dep.classid = 'pg_class'::regclass
        AND dep.objid = c.oid
        AND dep.deptype = 'i'
    )
  )
,
  
  view_defs AS (
    SELECT json_build_object(
      'kind', 'VIEW',
      'name', c.relname,
      'namespace', s.name
    ) AS defs
    FROM pg_class c
    JOIN schemas s ON s.oid = c.relnamespace
    WHERE c.relkind = 'v'
  )
,
  
  function_defs AS (
    SELECT json_build_object(
      'kind', 'FUNCTION',
      'name', p.proname,
      'namespace', s.name
    ) AS defs
    FROM pg_proc p
    JOIN schemas s ON s.oid = p.pronamespace
    WHERE p.prokind = 'f'
  )

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
