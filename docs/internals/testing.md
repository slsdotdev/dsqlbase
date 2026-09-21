# Testing

_Audience: contributors and agents._

## Commands

From the repo root (Turbo fans out across workspaces):

| Command            | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `npm test`         | Vitest in every package (builds dependencies first)            |
| `npm run coverage` | Vitest with `--coverage` (v8)                                  |
| `npm run e2e`      | `test:e2e` in `packages/tests` (PGlite)                        |
| `npm run lint`     | ESLint across packages; also runs in the Husky pre-commit hook |

Per package (`cd packages/<pkg>`):

- `npm test` — that package's suite. In `packages/dsqlbase` this also runs the type-level suite: `vitest.config.ts` enables `test.typecheck` over `src/**/*.types.test.ts`, checked against `tsconfig.test.json` (the package's build `tsconfig.json` excludes test files, so type tests need their own include set). A failed `expectTypeOf` is reported as a failing test, not as a silent no-op.
- `npx vitest run path/to/file.test.ts` — one file.
- `npx vitest run -t "name of test"` — one test by name.
- `npx vitest dev` — watch mode.

## Layout

- Unit tests sit next to the source (`foo.ts` / `foo.test.ts`).
- Type-level tests sit next to the source too, as `foo.types.test.ts`, and use `expectTypeOf` / `assertType`. They only run where `test.typecheck` is enabled — today that is `packages/dsqlbase`.
- `packages/tests/src/specs/` holds end-to-end specs that run the full schema → migration → client stack against in-process PGlite. `src/db/schema/schema.ts` is the shared fixture; `src/db/client.ts` and `src/db/migrate.ts` are the reference wiring.
- There is no DSQL cluster in CI. Anything that only DSQL can answer is listed in [DSQL capabilities → To verify](./dsql-capabilities.md#to-verify-on-a-real-dsql-cluster).

## Conventions

- **Failing tests stay failing.** When a test catches a real implementation bug, do not `.skip`, `.fails`, or loosen the assertion. Document the bug next to the test and fix the implementation (in the same story if it is a prerequisite).
- **Narrow with `?.`, never by throwing.** Inside a test body use `expect(x?.field).toBe(...)`; do not `if (!x) throw` to narrow a type.
- Migration-layer fixtures use raw `SerializedObject<…>` JSON rather than the high-level builders, so a builder change does not silently rewrite what the reconciler is being tested against.
- PGlite has no `ASYNC` — run the runner with `asyncIndexes: false` in e2e.
- The turbo `test` task declares `dependsOn: ["^build"]`: a package's tests resolve its workspace dependencies through their `dist/`, so those are built first. `npm run coverage` runs the same task and inherits this.

## Related

- [Conventions](./conventions.md)
- [Architecture](./architecture.md)
