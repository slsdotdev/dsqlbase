# Contributing

Thanks for your interest in dsqlbase. The project is small and early-stage — please open an issue before sinking time into a PR.

## Bug reports

Open an issue at <https://github.com/slsdotdev/dsqlbase/issues> with:

- dsqlbase version (or commit SHA if running from main)
- Node and npm versions
- A minimal reproduction — schema definition plus the query or migration that misbehaves
- Expected vs actual behaviour, and any error output

If the bug is in migration planning, including the output of `runner.dryRun(...)` or `runner.plan(...)` is usually the fastest path to a diagnosis.

## Feature requests

Open an issue describing the use case and the DSQL constraint or workflow it addresses. Scope is intentionally narrow (DSQL-shaped Postgres) — features that don't fit DSQL's distributed model, or that paper over its limitations rather than embrace them, are unlikely to land. Saying so up front saves everyone time.

## Before opening a PR

Please open or comment on an issue first to align with maintainers on the approach. Drive-by PRs without prior discussion may be closed without review.

## Local development

Requirements: Node `>=24.14.1`, npm `>=11.11.0`. The repo is an npm-workspaces + Turborepo monorepo. `yarn` and `pnpm` are blocked via `engines`.

```bash
npm install
npm run build
npm test
npm run lint
```

`packages/tests` runs end-to-end specs against [PGlite](https://github.com/electric-sql/pglite) (`npm run test:e2e` from that package). Husky runs `npm run lint` on pre-commit; please don't bypass it.

## Changesets

If you change a published package (`@dsqlbase/core`, `@dsqlbase/migration`, or `dsqlbase`), add a changeset rather than bumping `version` by hand:

```bash
npm run changeset
```

## Code of conduct

By participating, you agree to abide by the project [Code of Conduct](./CODE_OF_CONDUCT.md).
