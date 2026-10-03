---
"dsqlbase": patch
"@dsqlbase/core": patch
---

The `pg` session returns every transaction's connection to the pool exactly once. A failed `BEGIN`, `COMMIT` or `ROLLBACK` used to keep the connection checked out, so the pool ran dry one failure at a time. A broken connection is now destroyed rather than reused, and `rollback()` doesn't throw. `$transaction` always throws the error that caused the rollback, so a `40001` is still retried when the rollback fails too. The PGlite session waits for `BEGIN`. `TransactionSession` documents this contract for custom sessions.

Docs: docs/guide/sessions.md, docs/guide/transactions.md
