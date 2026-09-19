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

## Design and documentation

- Architecture, pipelines, and conventions are documented in [`docs/internals/`](./docs/internals/README.md); read it before proposing a change.
- Non-trivial work starts as a proposal in `.claude/proposals/`; multi-story work is tracked in `.claude/epics/`. Accepted designs are recorded in [`docs/decisions/`](./docs/decisions/README.md).
- **Docs are part of done.** Every proposal ends with a `## Docs` section, every story names the `docs/` pages it changes, and a PR is not complete until those pages are updated. The full rule is in [Conventions → Documentation](./docs/internals/conventions.md#documentation).

## Changesets

If you change a published package (`@dsqlbase/core`, `@dsqlbase/migration`, or `dsqlbase`), add a changeset rather than bumping `version` by hand:

```bash
npm run changeset
```

The changeset body must carry a `Docs:` line naming the documentation pages touched, or `Docs: none — <reason>`.

## Code of conduct

By participating, you agree to abide by the project [Code of Conduct](./CODE_OF_CONDUCT.md).
