---
"dsqlbase": minor
---

Assemble every `WHERE` in one place, and let a column be marked read-only.

**The where seam.** `OperationsFactory._validateWhereExpression` was a stub called only when the
caller passed a filter, so a `findMany({})` never reached it, and it returned `where[0]` when
given an array — silently dropping every other condition. It is now `_resolveWhere(table, where?)`
and runs for every select (the root and every nested join level), every update and every delete,
filter or no filter. That is what makes it usable as an injection point: a rule that only applied
when the caller happened to filter would not be a rule.

Several conditions are AND-ed, each wrapped so an `OR` among them keeps its precedence; a lone
condition is returned untouched, so no existing query gains parentheses. **Breaking for direct
`@dsqlbase/core` callers**: an array `where` now means "all of these" instead of "the first of
these". No `dsqlbase` client path produces an array — the normalizer folds a `where` object into
one node — so queries written against the client are unaffected.

**Read-only columns.** `.readOnly()` marks a column system-managed:

```ts
const invoices = table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().readOnly(),
  number: text("number").notNull(),
});
```

`workspaceId` is read like any other column — selectable, filterable, orderable, present on the
row — but it is gone from `create`'s `data` and `update`'s `set`, in the types and at runtime.
A `notNull` column with no default therefore stops being a *required* input, which is the point:
the value belongs to whatever manages the column, not to the caller. A field that arrives through
an untyped spread is dropped by the normalizer rather than refused, so `create({ data: { ...input } })`
keeps working; a direct `OperationsFactory` caller that passes one gets
`Cannot write read-only column "…"`, beside the existing primary-key refusal.

`toJSON` is unchanged, so the flag is invisible to migrations and introspection — it is a
client-side rule, and a real database cannot report it.

Docs: docs/internals/runtime-pipeline.md, docs/guide/schema.md, docs/guide/querying.md
