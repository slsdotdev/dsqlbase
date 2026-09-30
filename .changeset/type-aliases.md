---
"@dsqlbase/core": patch
"@dsqlbase/migration": patch
"dsqlbase": patch
---

Declare every exported object type with `type` instead of `interface`, enforced by `@typescript-eslint/consistent-type-definitions`. The shapes are unchanged. The one visible difference: a consumer can no longer merge declarations into an exported type (for example `declare module "dsqlbase" { interface QueryArgs … }`), since type aliases do not merge.

Docs: docs/guide/sessions.md (the `Session` snippet), docs/internals/conventions.md (the lint rule).
