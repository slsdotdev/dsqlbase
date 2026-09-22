---
"dsqlbase": patch
---

Run the type-level test suite for real. `packages/dsqlbase` documented itself as running `vitest run --typecheck`, but no vitest config enabled `typecheck`, the package `test` script was plain `vitest run`, and the build `tsconfig.json` excludes `*.test.ts` — so every `expectTypeOf` assertion in `client.types.test.ts` was a no-op. `vitest.config.ts` now enables `test.typecheck` over `src/**/*.types.test.ts` against a new `tsconfig.test.json`, and a failed type assertion is reported as a failing test. The turbo `test` task also gains `dependsOn: ["^build"]`, so a package's workspace dependencies are built before its tests run instead of relying on a `dist/` left over from an earlier build. No runtime or published-API change.

Docs: docs/internals/testing.md, CLAUDE.md
