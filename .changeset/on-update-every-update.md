---
"@dsqlbase/core": minor
"dsqlbase": minor
---

`$onUpdate` runs on every update. It used to run only when the update also named its column, so a hook such as `updatedAt.$onUpdate(() => new Date())` never fired on its own. A value the update sets still wins over the hook, and a `.readOnly()` column with a hook is written too.

The hook's value is now validated and encoded by the column like any written value; `Column.getUpdateValue` returned it raw before.

Breaking: an update writes every column with an `$onUpdate` hook, named or not.

Docs: docs/guide/schema.md
