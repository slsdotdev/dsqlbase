---
"dsqlbase": patch
---

Attach models through one shared code path, keyed by schema alias.

- `Table.alias` (`@dsqlbase/core`) carries the key a table is exported under, which may differ from the database table name (`members` vs. `team_members`). `SchemaRegistry` sets it; it defaults to the table name when a `Table` is constructed directly.
- `SchemaRegistry.getTableEntries()` lists each table once, keyed by alias, and `getAlias(nameOrAlias)` resolves either name to the alias. `getTables()` is unchanged — it still keys every table under both its alias and its database name.
- `attachModels(client, ctx)` in `packages/dsqlbase/src/client/database/base.ts` replaces the duplicated attachment loops in `createClient` and the transaction client, and records each model in `BaseClient._models`. A scoped client should now be built through it rather than by copying the loop.

Behaviour change: models are attached once, under the alias only. A client over a schema with an aliased table previously also exposed a second model under the database table name (`dsql.team_members` alongside `dsql.members`) — that duplicate is gone. It was never part of the typed surface, since `Models<T>` is keyed off the schema object, so only code indexing the client dynamically could reach it.

Docs: docs/internals/runtime-pipeline.md
