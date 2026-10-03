---
"@dsqlbase/migration": patch
---

A changed index is rebuilt without a gap. The new index is built beside the old one as `<name>_rebuild`, the old one is dropped, and the new one is renamed into place, so the old index serves reads and enforces uniqueness until its replacement exists. Before, the old index was dropped first, leaving it unavailable (and a unique one unenforced) for the whole build. A changed UNIQUE constraint likewise builds its new index first; only the drop of the old constraint and the promotion of the new index run without it.

If a run stops part-way, the next one drops the `_rebuild` (or UNIQUE `_idx`) index it left behind and starts that step over, instead of treating it as an index the definition lacks. Names the planner derives are kept within PostgreSQL's 63 bytes. Also fixes the planner reporting a dependency cycle for a change whose steps reference the same table — for example, changing the type of a column that has both an index and a CHECK.

Docs: docs/guide/migrations.md (Constraints and indexes on existing tables), docs/internals/migration-pipeline.md (Operations, Planner).
