# Testing

_Audience: contributors and agents._

## Commands

From the repo root (Turbo fans out across workspaces):

| Command            | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `npm test`         | Vitest in every package                                        |
| `npm run coverage` | Vitest with `--coverage` (v8)                                  |
| `npm run e2e`      | `test:e2e` in `packages/tests` (PGlite)                        |
| `npm run lint`     | ESLint across packages; also runs in the Husky pre-commit hook |

Per package (`cd packages/<pkg>`):

- `npm test` — that package's suite. `packages/dsqlbase` runs `vitest run --typecheck`: type-level tests (`*.types.test.ts`) are part of the suite.
- `npx vitest run path/to/file.test.ts` — one file.
- `npx vitest run -t "name of test"` — one test by name.
- `npx vitest dev` — watch mode.

## Layout

- Unit tests sit next to the source (`foo.ts` / `foo.test.ts`).
- `packages/tests/src/specs/` holds end-to-end specs that run the full schema → migration → client stack against in-process PGlite. `src/db/schema/schema.ts` is the shared fixture; `src/db/client.ts` and `src/db/migrate.ts` are the reference wiring.
- There is no DSQL cluster in CI. Anything that only DSQL can answer is listed in [DSQL capabilities → To verify](./dsql-capabilities.md#to-verify-on-a-real-dsql-cluster).

## Conventions

- **Failing tests stay failing.** When a test catches a real implementation bug, do not `.skip`, `.fails`, or loosen the assertion. Document the bug next to the test and fix the implementation (in the same story if it is a prerequisite).
- **Narrow with `?.`, never by throwing.** Inside a test body use `expect(x?.field).toBe(...)`; do not `if (!x) throw` to narrow a type.
- Migration-layer fixtures use raw `SerializedObject<…>` JSON rather than the high-level builders, so a builder change does not silently rewrite what the reconciler is being tested against.
- PGlite has no `ASYNC` — run the runner with `asyncIndexes: false` in e2e.

## Related

- [Conventions](./conventions.md)
- [Architecture](./architecture.md)
