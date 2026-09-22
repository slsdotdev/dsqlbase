# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Project

`dsqlbase` is a schema, query, and migration toolkit for AWS Aurora DSQL (PostgreSQL-compatible). npm-workspaces + Turborepo monorepo with four workspaces under `packages/`: `core` (primitives), `dsqlbase` (the public package: schema builders, client, `pg`/`pglite` sessions), `migration` (published as `@dsqlbase/migration`), and `tests` (private, PGlite e2e). Use `npm` / `npx` only — `yarn` and `pnpm` are blocked via `engines`. Node `>=24.14.1`, npm `>=11.11.0`, ESM only.

## Read the docs first

Architecture, the runtime pipeline and its known gaps, the codec boundary, the migration pipeline, the verified DSQL capability table, and the test conventions all live in **`docs/internals/`**. Start at `docs/internals/README.md` before proposing or implementing anything; cite those pages rather than restating them. Consumer-facing behaviour is in `docs/guide/`; accepted designs are in `docs/decisions/`.

## Common commands

Run from the repo root (Turbo fans them out across workspaces):

| Command | Purpose |
|---|---|
| `npm run build` | `tsc` build all packages (respects `^build` deps). |
| `npm run dev` | `tsc --watch` across packages. |
| `npm test` | Vitest in every package. |
| `npm run e2e` | PGlite end-to-end specs in `packages/tests`. |
| `npm run lint` | ESLint across packages. Runs automatically via Husky pre-commit. |
| `npm run coverage` | Vitest with `--coverage` (v8). |
| `npm run changeset` / `npm run publish` | Versioning + publishing via Changesets. |

Per package: `cd packages/<pkg>` then `npm test`, `npx vitest run path/to/file.test.ts`, or `npx vitest run -t "name"`. `packages/dsqlbase` enables `test.typecheck` in its `vitest.config.ts`, so type-level tests (`*.types.test.ts`) run as part of `npm test`. Details: `docs/internals/testing.md`.

## Rules

- **Branch off `main`** before any change; `main` is the release branch.
- **Proposal before non-trivial work**: write `.claude/proposals/<name>.md` first. Multi-story work is tracked in `.claude/epics/<name>.md`. Both are **untracked working notes** — `.claude/` is gitignored, so nothing outside it may depend on one. On acceptance, design text moves to `docs/internals/`, a record is added to `docs/decisions/`, and the proposal is deleted; carry the reasoning worth keeping across first, since there is no history to recover it from.
- **Known gaps are prerequisites, not constraints.** If a feature needs a deficiency listed in `docs/internals/runtime-pipeline.md` fixed, the fix is a prerequisite story; do not design around it. Public API may break — say so and name the changeset level.
- **Docs definition of done** (full text in `docs/internals/conventions.md#documentation`): every proposal ends with a `## Docs` section; every story names the docs pages it changes and is not done until they are updated in the same PR; every changeset body carries a `Docs:` line (pages touched, or `Docs: none — <reason>`); a change that alters a documented claim fixes the doc in the same change.
- **Changesets** for every published-package change (`npm run changeset`); never bump `version` by hand.
- **Husky pre-commit** runs lint. Don't bypass it.
- **Tests**: failing tests that catch real bugs stay failing; narrow with `?.` in `expect`, never by throwing. See `docs/internals/testing.md`.
- **Code style**: match the surrounding code; imports use explicit `.js` extensions (`nodenext`); cite code by path, never by line number, in any doc or proposal.
