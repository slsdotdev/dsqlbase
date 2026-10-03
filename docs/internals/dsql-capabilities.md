# DSQL capabilities

_Audience: contributors and agents. This is the reference the migration module's policy layer must agree with._

**Verified: 2026-10-03**, two ways:
- **Docs:** the AWS docs linked below, fetched that day.
- **Live:** every statement form marked **live** below was run against an Aurora DSQL cluster in
  `eu-central-1` (`SELECT version()` → `PostgreSQL 16`). The docs are silent on several of these,
  and wrong on a few.

Re-verify, and update the date, whenever the migrations work audits DSQL. Don't restate DSQL rules
from memory anywhere else; link here.

Sources:
- SQL feature index: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-subsets.html
- Supported SQL overview: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html
- `ALTER TABLE`: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html
- `CREATE INDEX`: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-index-syntax-support.html
- DDL and transactions: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html
- Migration guide (now also the target of the old "unsupported features" URL): https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html
- System tables and `sys.jobs`: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-systems-tables.html
- Quotas: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html
- Data types: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-data-types.html

## Tables and columns

"Module" describes `packages/migration/src/reconciliation/operations/`. Rows marked
**refused (stale)** are stricter than DSQL; the migrations catch-up removes them.

| Form | DSQL | Module |
|---|---|---|
| `CREATE TABLE`: columns, PK, UNIQUE, CHECK, DEFAULT, identity (`(sequence_options)` required, bigint only), generated `STORED` | supported | emitted |
| `CREATE TABLE`: `REFERENCES` / `FOREIGN KEY` (all referential actions, `MATCH`, `DEFERRABLE`) | supported (live) | not modelled; `relations()` is runtime-only |
| `ADD COLUMN [IF NOT EXISTS] name type` | supported (live) | emitted |
| `ADD COLUMN` with `DEFAULT`, `NOT NULL`, `CHECK`, `UNIQUE`, identity or generated | **refused** (live: `0A000 ALTER TABLE ADD COLUMN with constraint not supported`), even though the docs say "same syntax as CREATE TABLE" | refused, unless the attribute can follow as its own statement |
| Several actions in one `ALTER TABLE` | supported (live) | — |
| `DROP COLUMN [IF EXISTS]` (drops the column's indexes too; 255 active / 1,600 lifetime columns) | supported (live) | refused `NO_DROP_COLUMN` **(stale)** |
| `DROP COLUMN` on a primary-key column | refused (live: `cannot drop primary key column`) | — |
| `ALTER COLUMN SET DEFAULT` / `DROP DEFAULT` | supported (live) | refused `IMMUTABLE_COLUMN` **(stale)** |
| `ALTER COLUMN DROP NOT NULL` | supported (live) | refused **(stale)** |
| `ALTER COLUMN SET NOT NULL` | refused (live) | refused |
| `ALTER COLUMN SET DATA TYPE` | refused (live) | refused |
| `ALTER COLUMN DROP EXPRESSION [IF EXISTS]` (generated → plain) | supported (live) | not modelled |
| `ALTER COLUMN SET STORAGE` | supported (live) | not modelled |
| Identity: `ADD GENERATED … AS IDENTITY (CACHE …)`, `SET GENERATED`, `SET <sequence option>`, `RESTART`, `DROP IDENTITY` | supported (live) | add / type / restart / drop emitted; other options not yet |
| `RENAME` table / column / constraint, `SET SCHEMA`, `OWNER TO` | supported (live for renames) | AST and printer only |

## Constraints

| Form | DSQL | Module |
|---|---|---|
| `ADD CONSTRAINT … CHECK` without `NOT VALID` | refused (live) | — |
| `ADD CONSTRAINT … CHECK … NOT VALID` (enforced at once on new writes, `convalidated = false`) | supported (live) | refused `IMMUTABLE_CONSTRAINT` **(stale)** |
| `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` → `job_id`, `job_type = VALIDATE_CONSTRAINT` | supported (live) | not modelled |
| `ALTER TABLE … VALIDATE CONSTRAINT` (synchronous) | refused (live) | — |
| A failed validation | the job fails (`check constraint "…" is violated by some row`); the constraint stays, `NOT VALID` (live) | — |
| `ADD CONSTRAINT FOREIGN KEY … NOT VALID`, validate, `ALTER CONSTRAINT … [NOT] DEFERRABLE` | supported (live) | not modelled |
| `ADD CONSTRAINT … UNIQUE USING INDEX` (the index must be valid; renames it to the constraint) | supported (live) | emitted (promotion path) |
| `ADD CONSTRAINT UNIQUE (cols)`, `ADD PRIMARY KEY` | refused (live) | refused |
| `DROP CONSTRAINT [IF EXISTS]` on CHECK, UNIQUE (also drops its index) or FK | supported (live) | refused **(stale)** |
| `DROP CONSTRAINT` on the primary key | refused (live) | — |

## Indexes

| Form | DSQL | Module |
|---|---|---|
| `CREATE [UNIQUE] INDEX ASYNC [IF NOT EXISTS] name ON table (…)` | supported; `ASYNC` is required **even on an empty table** (live) | emitted |
| `NULLS FIRST \| LAST`, `INCLUDE (columns)`, `NULLS [NOT] DISTINCT` | supported (live) | emitted |
| Expression keys `((expr))`, partial `WHERE predicate` (immutable only) | supported (live) | not modelled |
| `ASC` / `DESC` on a key | refused (live: `specifying sort order not supported for index keys`) | not offered |
| Schema-qualified index name | refused (docs); the index lives in its table's schema | — |
| A failed build (e.g. duplicates for `UNIQUE`) | the job fails; the index stays, `indisvalid = false`; a unique one still enforces uniqueness on writes until dropped (docs, live) | not read by introspection |
| `DROP INDEX [IF EXISTS] … [RESTRICT \| CASCADE]` | supported (live; no grammar published) | emitted |
| `ALTER INDEX … RENAME TO` | supported (live; not listed in the docs) | not modelled |

The catalog reports the index method as `btree_index`. A primary key's index lists every other column as `INCLUDE` (live), columns added later too: the table is stored by its key.

## Domains, sequences, schemas, views

| Form | DSQL | Module |
|---|---|---|
| `CREATE DOMAIN … DEFAULT … NOT NULL CONSTRAINT … CHECK (…)` | supported (live; no grammar published) | emitted |
| `ALTER DOMAIN` `SET DEFAULT`, `DROP DEFAULT`, `DROP NOT NULL`, `RENAME`, `RENAME CONSTRAINT` | supported (live; not listed in the docs) | `SET` / `DROP DEFAULT` emitted |
| `ALTER DOMAIN SET NOT NULL`, `ADD CONSTRAINT` (with or without `NOT VALID`) | refused (live) | refused |
| `ALTER DOMAIN DROP CONSTRAINT` / `VALIDATE CONSTRAINT` | **unverified** | — |
| `DROP DOMAIN [RESTRICT]` (blocked while a column uses it) | supported (live) | emitted, after the tables that use it |
| `DROP DOMAIN … CASCADE` | refused (live: `DROP DOMAIN with CASCADE unsupported`) | never emitted |
| `CREATE SEQUENCE … CACHE 1 \| >= 65536` (`CACHE` required; options in any order; bigint only) | supported (docs, live) | emitted; `INVALID_SEQUENCE_CACHE` |
| `ALTER SEQUENCE` options, `AS bigint`, `RESTART`, `OWNED BY`, `RENAME` | supported (live) | changed options emitted |
| `DROP SEQUENCE` | supported | emitted |
| `CREATE SCHEMA`, `DROP SCHEMA [CASCADE]` (10 schemas max) | supported (live) | emitted (`RESTRICT`) |
| `CREATE [OR REPLACE] [RECURSIVE] VIEW`, `ALTER VIEW` (all forms), `DROP VIEW` | supported (live) | not modelled |

## Other

- **Catalogs:** `pg_sequence`, `pg_sequences`, `information_schema.sequences`, `pg_proc`,
  `pg_attrdef`, `pg_depend` and `pg_description` are all readable (live). The docs' catalog
  table says otherwise and is out of date. `pg_get_indexdef`, `pg_get_expr` (including
  `indpred`), `pg_get_constraintdef` and `pg_get_viewdef` all work.
- **`COMMENT ON TABLE` / `COLUMN`:** works, and reads back from `pg_description` (live). The
  docs only list `COMMENT ON ROUTINE`.
- **Async DDL:** `CREATE INDEX ASYNC` and `ALTER TABLE ASYNC … VALIDATE` return a `job_id`.
  - `CALL sys.wait_for_job(id)` blocks until the job ends and returns `{ succeeded: boolean }`.
    It's a procedure, so `SELECT sys.wait_for_job(id)` fails (live).
  - `sys.jobs` columns are snake_case: `job_id`, `status`, `job_type`, `details`,
    `object_name`, …
  - `job_type` is one of `INDEX_BUILD`, `VALIDATE_CONSTRAINT`, `DROP` or `ANALYZE`.
  - Finished jobs are kept for 30 minutes.
  - Index builds took 5–24 s each on empty tables (live).
- **Transactions:** one DDL statement per transaction; DDL and DML in separate transactions; 3,000 rows and 10 MiB written per transaction; 5-minute transaction age. A stale catalog after another session's DDL surfaces as `40001` (`OC001`); retrying refreshes it.
- **Limits:** 24 indexes per table; 8 columns per primary key or index (1 KiB key); 255 active columns; 1,000 tables; 5,000 views and 5,000 sequences; 5 extended statistics per table.
- **Identifiers:** a 64-byte name is **silently truncated to 63** (live), as in Postgres. The AWS docs don't state the limit (validated: `IDENTIFIER_TOO_LONG`).
- **`numeric`:** declared without precision, a column is stored as **`numeric(18,6)`**, so values are rounded to 6 decimals and more than 12 integer digits overflow (live). An explicit precision of up to 1000 works. The `numeric()` builder states `(18,6)` explicitly and refuses writes that would be rounded.
- **JSON:** `json` and `jsonb` are storable, each value limited to 1 MiB **compressed**, with **no index support**. All PostgreSQL JSON functions and operators work. `CREATE TYPE` isn't supported, so there are no composite or enum types. Arrays and `inet` are query-runtime types only.
- **Functions and statistics:** `CREATE [OR REPLACE] FUNCTION … LANGUAGE sql` and `ALTER FUNCTION` (rename, owner, schema) are supported; `CREATE STATISTICS` is supported too. Neither is modelled.
- **Not supported:** `CREATE TYPE`, `CREATE PROCEDURE`, PL/pgSQL, row-level security, temporary tables and views. The migration guide gives replacements for triggers and `TRUNCATE` (`DELETE FROM`). Permissions are `GRANT`s.
- **Unsupported PG types** (`money`, `xml`, `tsvector`, ranges, inherited tables) are excluded at compile time by the column builders; there's no runtime rule.

## To verify on a real DSQL cluster

| Item | How to verify | If different |
|---|---|---|
| `ALTER DOMAIN DROP CONSTRAINT` / `VALIDATE CONSTRAINT` on an existing domain constraint | create a domain with a `CHECK`, then drop it | removing a domain `CHECK` stays refused |
| Row-value comparison `(a, b) < ($1, $2)` | `SELECT … WHERE (a, b) < (1, 2)` | nothing: `sql.keyset` expands key by key; if supported, it may become an optimisation |
| Whether a session can change `DateStyle` | `SET DateStyle = 'SQL, DMY'`, then read a `date` as text | keyset cursors carry `::text` values; if it can change, cast order keys to a fixed format |

## Related

- [Migration pipeline](./migration-pipeline.md)
- [DSQL notes (guide)](../guide/dsql-notes.md)
