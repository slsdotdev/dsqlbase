# 0007 — Global ids

- **Date:** 2026-09-27
- **Status:** accepted
- **Proposal:** `schema-guid.md` (local working artifact, not tracked)

## Context

Every id that leaves the ORM has to identify both the row and its table, and any row has to be retrievable from that value alone. A bare `uuid` does neither: an API exposing `node(id)` has nowhere to start, a resolver handed an `ID` cannot tell one table's id from another's, and filtering with the wrong one returns nothing rather than failing. Relation-key columns make it worse — `user.workspaceId` and `user.workspace.id` are the same row and, unwrapped, do not compare equal.

Wrapping at the application boundary was the alternative actually on the table (Options F and G below). It cannot validate a write or a filter, and it leaves every non-GraphQL consumer — claims, events, jobs, tests — to wrap by hand.

## Decision

- **`guid()` is a `uuid` column with a codec.** It lives entirely in `dsqlbase`; `@dsqlbase/core` is untouched. Nothing below the client has an opinion about the shape of an id — core sees a column with a codec, exactly as it sees an `interval` column with a `Duration` codec.
- **A table is a node iff its primary key is exactly one `guid()` column.** Its key is the table's **schema alias**, so ids follow the identity the client addresses (`members`, not `team_members`) and a database rename does not invalidate ids in the wild. An explicit `guid(col, key)` overrides it and doubles as a stable label.
- **The payload is `guid:` + base64url of `[tableKey, { [keyField]: value }]`.** The prefix makes "already wrapped?" exact, since a uuid never starts with `guid:`. The payload names its key field rather than assuming `id`.
- **Binding happens once, when the client is built.** A codec sees one value and no context, but it needs the node key — which defaults to the schema alias — and the _target's_ key field name. Neither is knowable where the column is declared, so `createClient` resolves every guid column against the whole schema and installs the bound codec on the built `Column`.
- **One swap covers every direction.** `Column` funnels reads through `codec.decode` and writes and filters through `codec.encode`, so nothing in the pipeline changed.
- **Input is lenient, wrapped input is checked.** A raw uuid is accepted; a wrapped id naming another node throws `GlobalIdError("key_mismatch")` when the query is built. That check is the thing generated middleware cannot provide.
- **`$findByGlobalId({ id, on? })` and `$listByGlobalId({ ids, on? })` go through the model clients**, never issuing SQL of their own, so a node lookup inherits the tenant predicate structurally rather than by remembering to.
- **`$$key`, not `$$meta.key`, is the discriminant** — see below.
- **Both sides of a relation pair must agree**: both guid columns naming the same node, or neither.

## `$$meta.key` cannot discriminate a union

[0004](./0004-record-meta.md) assigned this feature two debts: make `$$meta.key` the literal alias, and use it to narrow the row union a node lookup returns. The first is done. The second is not possible: **TypeScript does not narrow a union on a nested property.** `record.$$meta.key === "authors"` compiles and narrows nothing, while `record.$$key === "authors"` narrows.

`$$key` has been a reserved field name since 0004, held for polymorphic relations' discriminator. The lookup methods tag each row with it — the literal alias, the same value `$$meta.key` carries. It is added by the lookups rather than by the resolver, so an ordinary `findOne` row is unchanged: a single-table read has nothing to discriminate.

`schema-polymorphic-relations.md` assumes the nested form too, and inherits the working one instead.

## Rejected alternatives

- **Table-level `node()` marker with `wrap`/`unwrap` helpers and a virtual `nodeId` field** — joined rows stay raw, so `workspace.id` still needs wrapping in the application; a virtual field needs normalizer and type support that does not exist.
- **A client-level registry** (`createClient({ nodes: { User: users } })`) — the same boundary burden, with the mapping repeated per client and invisible to the schema.
- **Storing the global id in the database as a text primary key** — loses the uuid type and index size, migrates every row, and bakes the table name into data that outlives renames.
- **Generated middleware only, ORM untouched** (Option F) — a static shape map cannot type an interface or union field, an `ID` input has no declared target so it is unwrapped without a check, and a wrong map entry leaks raw ids silently.
- **`$$meta` plus generated middleware** (Option G) — correct for interfaces because it dispatches on a runtime typename, but it forecloses wrong-table validation on writes and filters, and leaves non-GraphQL consumers to wrap by hand. It was the planned stop-here point; moving global ids out of `core` removed `$$meta.globalId`, which was the only thing that made it shippable on its own.
- **A thunk reference for the key** (`guid("workspace_id", () => workspaces)`) — ambiguous against composite keys, and an import cycle.
- **Inferring the key from relations** — a column's wire format would depend on a relation declared elsewhere, and a key column without a relation would stay raw. Kept as validation instead.
- **Binding the codec on the `ColumnDefinition`** — needs no escape hatch, but a definition is the user's object and may be shared by two clients; a binding depends on the alias the table was exported under, so one client could re-key the other's ids. The codec is written onto the built `Column` instead.
- **A two-phase bind** (the constructor binds the key, the registry binds the target field) — a reference column needs the target's key field, which does not exist until every table is built, so the first phase can only ever do half the job.
- **Composite-key nodes** — `guid()` can only name one column, so nothing could declare the other half. The payload keeps its object form so the format will not have to change if that ever lands.
- **A branded `Guid<Key>` value type** — plain `string` inputs are not assignable to a branded type, so it needs separate input and output types on the column config. `valueType` stays `string`.
- **A `strict` option rejecting raw uuids** — a one-line follow-up if it is ever wanted.
- **`on` carrying `where` and `join`** — narrowed to `select` for a first cut, per 0004. Polymorphic relations widens the same type.
- **Dynamic node keys** — a keyless `guid()` column whose key is read per row from a discriminator column, so one column can point at several tables. It is the one case where a relation would decide a column's key, because the key is per row and the relation is the only place naming the discriminator. Deferred to polymorphic relations, which is the only thing that needs it; an explicit static key together with a discriminator would have to throw.

## Consequences

- **`@dsqlbase/core` is unchanged by this feature.** The whole of it is `dsqlbase/schema/utils/global-id.ts`, `dsqlbase/schema/columns/guid.ts` and `dsqlbase/client/nodes.ts`.
- **A guid column's wire format changes on read, write and filter.** Adopting `guid()` on an existing column is a no-op migration but a visible change to every consumer of that value.
- **`$$meta.key` is now the literal alias** rather than `string`, on every result row. It is a reverse lookup over the schema matched on the database _table name_, not on the whole table type: a join level rebuilds its target from parts, so structural matching finds the root level and misses every nested one. `SchemaRegistry` already keys its table map by name, so two tables in one schema cannot share one.
- **Rows from `$findByGlobalId` / `$listByGlobalId` carry `$$key`.** Rows from a model method do not.
- **Three schemas that used to build now throw**: two tables claiming one node key, a guid column naming no node, and a relation pair whose guid columns disagree.
- **A `SchemaRegistry` built by hand has no nodes**, and its guid columns behave exactly like the `uuid()` they serialize as. Binding belongs to `createClient`.
- Changeset level `minor`.

## Docs

- [Global ids (guide)](../guide/global-ids.md) — the whole feature from a consumer's side.
- [Schema (guide)](../guide/schema.md) — `guid()` and the node rules.
- [Relations (guide)](../guide/relations.md) — the guid pair rule.
- [Querying (guide)](../guide/querying.md) — `$$meta.key` as a literal, and `$$key`.
- [Codec boundary](../internals/codec-boundary.md) — where a guid column's codec is bound.
- [Runtime pipeline](../internals/runtime-pipeline.md) — the node registry beside the derived-client pattern.
- [Architecture](../internals/architecture.md) — where the three new files live.
