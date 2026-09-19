# DSQL capabilities

_Audience: contributors and agents. This is the reference the migration module's policy layer must agree with._

**Verified: 2026-09-19** against the AWS docs linked below. Re-verify and update the date whenever the migrations work audits DSQL. Do not restate DSQL rules from memory elsewhere — link here.

Sources:
- SQL feature index — https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-subsets.html
- `ALTER TABLE` — https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html
- General constraints — https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with.html

## `ALTER TABLE` forms vs. the migration module

"Module today" describes `packages/migration/src/reconciliation/operations/` as of the verification date. Rows marked **refused (stale)** are stricter than DSQL requires and are candidates for the migrations proposal.

| Form | DSQL | Module today |
|---|---|---|
| `ADD COLUMN name type [STORAGE …]` (grammar is bare; prose says "same syntax as CREATE TABLE") | supported | supported, bare only |
| `DROP COLUMN [IF EXISTS] [RESTRICT\|CASCADE]` (not PK columns; 255 active / 1600 lifetime columns per table) | supported | refused `NO_DROP_COLUMN` **(stale)** |
| `ALTER COLUMN SET DEFAULT` / `DROP DEFAULT` | supported | refused `IMMUTABLE_COLUMN` **(stale)** |
| `ALTER COLUMN DROP NOT NULL` | supported | refused **(stale)** |
| `ALTER COLUMN SET NOT NULL` | not in grammar | refused (correct) |
| `ALTER COLUMN SET DATA TYPE` | not in grammar | refused (correct) |
| `ALTER COLUMN DROP EXPRESSION` (generated → plain) | supported | not modelled |
| Identity: `ADD GENERATED`, `SET GENERATED`, `RESTART`, `DROP IDENTITY` (explicit `CACHE` required) | supported | supported |
| `ALTER COLUMN SET STORAGE` | supported | not modelled |
| `ADD CONSTRAINT CHECK (…) NOT VALID`, then `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` (async job in `sys.jobs`) | supported | refused `IMMUTABLE_CONSTRAINT` **(stale)** |
| `ADD CONSTRAINT FOREIGN KEY … NOT VALID` (+ validate) | supported | refused `NO_FOREIGN_KEY` **(stale)** |
| `ADD CONSTRAINT UNIQUE USING INDEX` | supported | supported (promotion path) |
| `ADD PRIMARY KEY` | not in grammar | refused (correct) |
| `DROP CONSTRAINT [IF EXISTS]` (drops the owning index too) | supported | refused **(stale)** |
| `ALTER CONSTRAINT … [NOT] DEFERRABLE` (FK only) | supported | not modelled |
| `RENAME` table / column / constraint, `SET SCHEMA`, `OWNER TO` | supported | AST + printer yes; no rename detection in reconciliation |

## Other verified facts

- **`CREATE TABLE`** supports column `REFERENCES` and table `FOREIGN KEY` with `NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT`, `MATCH FULL | SIMPLE`, `DEFERRABLE [INITIALLY …]`; per-column `STORAGE`; `LIKE`; `INCLUDE` on PK and UNIQUE. `json` and `jsonb` are both supported types. FK checks add reads on every DML and surface as OCC serialization errors (`40001`); cascading actions count toward the 3,000-row transaction limit.
- **`CREATE [UNIQUE] INDEX ASYNC`**: expression columns `((expr))`, `NULLS FIRST | LAST` (no `ASC | DESC` in the grammar — verify), `INCLUDE`, `NULLS [NOT] DISTINCT`, partial `WHERE`. Index names cannot be schema-qualified.
- **Views**: `CREATE [OR REPLACE] [RECURSIVE] VIEW` with `CHECK OPTION`, `security_barrier`, `security_invoker`; `ALTER VIEW`, `DROP VIEW`. No temporary views; materialized views not mentioned.
- **Not supported**: row-level security (the `CREATE VIEW` page states it outright), triggers, PL/pgSQL, temp tables, `TRUNCATE`. Permissions are schema-level `GRANT`s.
- **Transactions**: one DDL statement per transaction; DDL and DML in separate transactions; 3,000 rows written per transaction. Async DDL returns a `job_id` (handled by `packages/migration/src/executor.ts`).
- **Sequences**: `CACHE` must be `1` or `>= 65536` (validated: `INVALID_SEQUENCE_CACHE`).
- **Identifiers**: 63 bytes (Postgres limit; validated: `IDENTIFIER_TOO_LONG`).
- **Generated columns**: `STORED` only.
- **Unsupported PG types** (`money`, `xml`, `tsvector`, ranges, inherited tables) are excluded at compile time by the column builders; no runtime rule.

## To verify on a real DSQL cluster

The docs are ambiguous or silent on these. There is no cluster in CI; each item states how it would be verified and what the design does if the answer differs.

| Item | How to verify | If different |
|---|---|---|
| `ADD COLUMN` with inline constraints (grammar bare, prose "same as CREATE TABLE") | run `ALTER TABLE t ADD COLUMN c int NOT NULL DEFAULT 0` | keep bare `ADD COLUMN`; emit `SET DEFAULT` / constraints as follow-up statements |
| `ASC | DESC` on index columns | `CREATE INDEX ASYNC … (c DESC)` | drop direction from `IndexDefinition` or refuse it |
| `DROP CONSTRAINT` on a primary key | attempt it | refuse PK drops explicitly |
| `VALIDATE CONSTRAINT` subject to the 3,000-row limit | validate on a table with > 3,000 rows | document as async job; no design change |
| `COMMENT ON` availability (matters for deprecation markers) | `COMMENT ON COLUMN …` | store deprecation markers in the definition only |

## Related

- [Migration pipeline](./migration-pipeline.md)
- [DSQL notes (guide)](../guide/dsql-notes.md)
