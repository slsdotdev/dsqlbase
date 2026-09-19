# dsqlbase documentation

_Audience: everyone. Start here._

This directory is the single reference for `dsqlbase`, for people using it and for people (and agents) changing it. It is plain markdown, browsable on GitHub.

## Who reads what

| You are… | Read |
|---|---|
| Using `dsqlbase` in an application | [`guide/`](./guide/README.md) |
| Changing the code, reviewing a PR, or writing a proposal | [`internals/`](./internals/README.md), then [`decisions/`](./decisions/README.md) |
| An agent working in this repo | [`internals/README.md`](./internals/README.md) first, then the pages it lists; `CLAUDE.md` at the repo root holds commands and rules |

## Page map

### Guide (consumers)

- [Install](./guide/install.md) — packages, peer dependencies, runtime requirements.
- [Schema](./guide/schema.md) — `table()`, column types, domains, `$enum`, sequences, namespaces.
- [Relations](./guide/relations.md) — `relations()`, `hasMany` / `hasOne` / `belongsTo`, and what relations do (and do not) do.
- [Querying](./guide/querying.md) — `createClient`, model methods, `QueryArgs`, raw SQL escape hatches.
- [Sessions](./guide/sessions.md) — the `Session` contract, `pg` and PGlite sessions, bringing your own.
- [Transactions](./guide/transactions.md) — `$transaction`, the transaction client, OCC retry.
- [Migrations](./guide/migrations.md) — the runner, its options, running against PGlite vs DSQL.
- [DSQL notes](./guide/dsql-notes.md) — what Aurora DSQL changes about schema design and DDL.

### Internals (contributors and agents)

- [Architecture](./internals/architecture.md) — workspaces, dependency direction, entrypoints, directory map.
- [Runtime pipeline](./internals/runtime-pipeline.md) — how a model call becomes SQL, and the known gaps in that chain.
- [Codec boundary](./internals/codec-boundary.md) — where column codecs apply and where they do not.
- [Migration pipeline](./internals/migration-pipeline.md) — invariants, diffs → operations → planner → runner.
- [DSQL capabilities](./internals/dsql-capabilities.md) — the verified DDL capability table with doc URLs.
- [Testing](./internals/testing.md) — commands, layout, test conventions.
- [Conventions](./internals/conventions.md) — tooling rules, proposals, and the docs definition of done.

### Decisions

- [Index](./decisions/README.md) — accepted design records, numbered.

## Page conventions

- Code is cited by path (`packages/dsqlbase/src/client/model/base.ts`), never by line number.
- DSQL capability claims carry the AWS doc URL and a `Verified: YYYY-MM-DD` line.
- Every page opens with an `_Audience_` line and ends with `## Related`.
- Stub pages carry a `> **Status: stub**` callout and list what they will contain.

How these pages stay current is defined in [Conventions → Documentation](./internals/conventions.md#documentation).
