---
"dsqlbase": patch
"@dsqlbase/core": patch
---

The `pg` session returns every transaction's connection to the pool exactly once. Before, a `BEGIN` that failed, or a `COMMIT` or `ROLLBACK` that failed, left the connection checked out for good, so each such failure shrank the pool until it ran dry. A connection that broke is now destroyed rather than returned, and `rollback()` no longer throws.

`$transaction` always throws the error that made it roll back: a rollback that failed too used to replace it, and a `40001` hidden that way was not retried. The PGlite session now waits for `BEGIN` before running the transaction, and a second `commit` or `rollback` is a no-op. `TransactionSession` documents this contract for custom sessions.

Docs: docs/guide/sessions.md, docs/guide/transactions.md (both written out from stubs).
