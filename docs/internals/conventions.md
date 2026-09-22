# Conventions

_Audience: contributors and agents._

## Tooling

- **Package manager**: `npm` / `npx` only. `yarn` and `pnpm` are blocked via `engines`.
- **TypeScript**: root `tsconfig.json` is `noEmit`, strict, ESNext, `module: "nodenext"`; package configs extend it and emit to `dist/`. Imports use explicit `.js` extensions even from `.ts` files (required by `nodenext`).
- **ESLint**: one flat config at the root (`eslint.config.mjs`) applying `typescript-eslint` strict + stylistic to every package. No per-package config.
- **Husky**: pre-commit runs `npm run lint`. Do not bypass it.
- **Changesets**: when a published package changes, add a changeset (`npm run changeset`); never bump `version` by hand. `@dsqlbase/core`, `@dsqlbase/migration`, and `dsqlbase` are a `fixed` group and version together. CI (`.github/workflows/release.yml`) builds, lints, tests, and publishes from `main`.
- **Branches**: work on a branch off `main`; `main` is the release branch.

## Design workflow

1. **Proposal first.** Non-trivial work starts as `.claude/proposals/<name>.md`. A proposal states the problem, the decision, rejected alternatives, and ends with a `## Docs` section (below).
2. **Gaps are prerequisites.** If a feature needs a known deficiency fixed (see [Runtime pipeline → Known gaps](./runtime-pipeline.md#known-gaps-fix-do-not-design-around)), the fix is a prerequisite story in the proposal — do not bend the feature to avoid it. Public API may change; name the changeset level.
3. **Epics** for multi-story work live in `.claude/epics/<name>.md` and record what shipped vs. what was proposed.
4. **Proposals and epics are untracked** (`.claude/` is gitignored, apart from configuration). They are one author's working notes, not a deliverable, and they go stale the moment the code lands. Nothing outside `.claude/` may depend on one: a decision record names its proposal for the author's own reference but must stand on its own.
5. **On acceptance**, durable design text moves into `docs/internals/`, a condensed record is added to [`docs/decisions/`](../decisions/README.md), and the proposal file is deleted. Whatever reasoning is worth keeping — rejected alternatives above all — has to be carried across first, because the proposal is about to vanish with no history behind it.

## Documentation

`docs/` is the single reference for consumers, contributors, and agents. These rules keep it current; they apply to every proposal, story, and PR.

1. **Every proposal ends with a `## Docs` section** listing: `docs/guide/` pages to add or change; `docs/internals/` pages to add or change; the decision record to add once accepted; any `CLAUDE.md` or package-README lines that become stale.
2. **Every implementation story names the docs pages it changes.** It is not done until those pages are updated in the same PR.
3. **Every changeset body carries a `Docs:` line** naming the pages touched, or `Docs: none — <reason>`.
4. **A change that alters a documented claim fixes the doc in the same change.** (The former "default limit 100" JSDoc on `QueryArgs.limit` is the canonical example.)
5. **Accepted proposals are condensed into `docs/decisions/NNNN-title.md`**; the proposal file is deleted.

Page rules:

- Cite code by path (`packages/dsqlbase/src/client/model/base.ts`), never by line number.
- DSQL capability claims link [DSQL capabilities](./dsql-capabilities.md) rather than restating; that page carries the URL and `Verified:` date.
- Every page opens with an `_Audience_` line and ends with `## Related`.
- Stubs carry `> **Status: stub**` and list intended contents and the code paths they will cover.
- Nothing consumer-specific: phrase needs generally, never by application name.

## Related

- [Testing](./testing.md)
- [Architecture](./architecture.md)
- [Decisions](../decisions/README.md)
