# DSQL notes

_Audience: application developers designing a schema for Aurora DSQL._

Aurora DSQL is PostgreSQL-compatible but distributed, and that changes what a schema tool can do. `dsqlbase` treats these as design inputs rather than obstacles. The authoritative, dated table is [DSQL capabilities](../internals/dsql-capabilities.md); this page is the short version.

Verified: 2026-09-19 against the [DSQL SQL feature reference](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-subsets.html).

## What is different

- **DDL is asynchronous and isolated.** One DDL statement per transaction, never mixed with DML. Index builds run as async jobs; the runner waits on them.
- **Optimistic concurrency.** No locks; conflicting transactions fail with `SQLSTATE 40001` and must be retried. `$transaction` retries for you (see [Transactions](./transactions.md)). Transactions are capped at 3,000 rows written.
- **Columns can be added and dropped, but not retyped.** `ADD COLUMN` (bare, no inline constraints), `DROP COLUMN`, `SET/DROP DEFAULT`, and `DROP NOT NULL` are supported. `SET NOT NULL` and `SET DATA TYPE` are not — plan a new column plus backfill instead.
- **Constraints are added `NOT VALID` then validated asynchronously.** `CHECK` and `FOREIGN KEY` can be added to existing tables that way; a primary key cannot be added after creation. Foreign keys add reads on every write and can surface as OCC failures.
- **Indexes are always `CREATE INDEX ASYNC`.** Unique constraints on existing tables are created by building a unique index first, then promoting it (`ADD CONSTRAINT … UNIQUE USING INDEX`).
- **No enum type, no row-level security, no triggers, no PL/pgSQL, no temp tables, no `TRUNCATE`.** `$enum` is a `text` domain with a `CHECK`. Permissions are schema-level grants.
- **Sequences** must declare `CACHE 1` or `CACHE >= 65536`.
- **Identifiers** are limited to 63 bytes (Postgres rule, enforced by the validator).

## What this means for `dsqlbase`

- Design columns to be additive. Renames are add-new + backfill + drop-old; the runner has no rename detection yet.
- Put invariants you might change later in the application, not in a `CHECK` you cannot alter in place.
- Expect the migration runner to *refuse* some changes rather than emit SQL DSQL would reject. Refusals name the reason.

## Related

- [Schema](./schema.md)
- [Migrations](./migrations.md)
- [DSQL capabilities (internals)](../internals/dsql-capabilities.md)
