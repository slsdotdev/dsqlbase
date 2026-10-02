---
"@dsqlbase/core": minor
"dsqlbase": minor
---

Column groups filter and order by their members. In `where`, a group takes `exists` — present when any of its columns is set, absent when every one is `NULL`, the rule a read returns `null` by — and the nested `where` over its members, with each member's own operators, `and` / `or` / `not`, and nested groups. Members are named only inside `where`, so none can be mistaken for an operator; anything else on a group throws. `orderBy` and `paginate` take a nested order object per group, never a direction on the group itself; a cursor records a member key by its field path.

Core adds `ColumnGroup.exists`. The client adds `GroupFilterOf`, `MembersWhereOf` and `MembersOrderByOf`; `WhereExpressionOf` and `OrderByExpressionOf` gain group branches (additive).

Docs: docs/guide/embeddable-objects.md, docs/guide/querying.md, docs/guide/pagination.md, docs/internals/runtime-pipeline.md
