---
"@dsqlbase/migration": minor
---

Domains change as far as DSQL allows. Verified on a live cluster.

- **Emitted:** `ALTER DOMAIN … SET` / `DROP DEFAULT`, `DROP NOT NULL`, and `DROP CONSTRAINT [IF EXISTS]` of the domain's CHECK. The last two are destructive: DSQL can't add a `NOT NULL` or a CHECK to an existing domain, so they can't come back.
- **Refused, with a workaround:** making a domain `NOT NULL`, adding a CHECK, or renaming its CHECK (`NO_ALTER_DOMAIN_CONSTRAINT`), and changing its type (`NO_ALTER_DOMAIN_TYPE`). The workaround is a new domain, with the columns moved to it. A CHECK whose name changed used to be refused as `IMMUTABLE_DOMAIN`, together with every other domain change.
- `formatPlan` names constraints and other definition objects in its Changes column instead of printing them as JSON.

Breaking: `IMMUTABLE_DOMAIN` is replaced by `NO_ALTER_DOMAIN_TYPE` and `NO_ALTER_DOMAIN_CONSTRAINT`.

Docs: docs/guide/migrations.md (Domains and sequences, Refusals), docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md
