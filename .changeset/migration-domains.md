---
"@dsqlbase/migration": minor
---

Domains change as far as DSQL allows: `SET` / `DROP DEFAULT`, and `DROP NOT NULL` and `DROP CONSTRAINT` of the domain's CHECK — both destructive, since DSQL can't add either back. Making a domain `NOT NULL`, adding or renaming its CHECK (`NO_ALTER_DOMAIN_CONSTRAINT`), and changing its type (`NO_ALTER_DOMAIN_TYPE`) are refused: define a new domain and move the columns to it.

**Breaking:** `IMMUTABLE_DOMAIN` is replaced by `NO_ALTER_DOMAIN_TYPE` and `NO_ALTER_DOMAIN_CONSTRAINT`.

Docs: docs/guide/migrations.md
