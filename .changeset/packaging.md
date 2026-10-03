---
"@dsqlbase/core": patch
"@dsqlbase/migration": patch
"dsqlbase": patch
---

Packaging fixes for every published package:

- **The MIT `LICENSE` is now in each tarball.** It was listed as `../../LICENSE`, a path npm ignores, so no release shipped it.
- **`engines.node` is declared, `>=22`**, and CI runs every suite on Node 22 as well as 24.
- **In `exports`, `types` comes before `default`**, as TypeScript expects. It resolved before only because the `.d.ts` files sit next to the `.js` files. `publint` and `attw` now check every package in CI.
- **`homepage` points to the repository.**
- **Sourcemaps include their sources**, so stack traces and debuggers show the original TypeScript. This makes the packages larger.
- **The build starts from an empty `dist/`**, so a deleted module can't linger in a tarball.

Docs: docs/guide/install.md (Requirements), docs/internals/conventions.md (Packaging), docs/internals/architecture.md.
