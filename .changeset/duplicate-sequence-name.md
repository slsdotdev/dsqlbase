---
"@dsqlbase/migration": patch
---

Validation reports `DUPLICATE_SEQUENCE_NAME` when an identity column's explicit sequence name is already used in its namespace — by another identity, a sequence, a table or an index. A schema with such a collision used to pass validation.

Docs: docs/internals/migration-pipeline.md (validation rules).
