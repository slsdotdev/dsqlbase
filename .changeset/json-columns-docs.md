---
"@dsqlbase/core": patch
"@dsqlbase/migration": patch
"dsqlbase": patch
---

Record the JSON columns design as decision 0011, add the verified DSQL JSON facts (storable, 1 MiB compressed, no index support; `CREATE TYPE` unsupported) to the capabilities page, and show `jsonb()` with `.schema()` in the package README. The e2e suite covers JSON columns against PGlite with zod.

Docs: docs/decisions/0011-json-columns.md, docs/decisions/README.md, docs/internals/dsql-capabilities.md, packages/dsqlbase/README.md
