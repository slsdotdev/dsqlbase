# 0022 — Pure codecs, runtime column hooks

- **Date:** 2026-11-05
- **Status:** accepted
- **Supersedes:** how `guid()` columns get their codec — "Binding happens once, when the client is
  built" in [0007](./0007-global-ids.md), and the codec left out of scope by
  [0020](./0020-column-references.md); the guid checks `createClient` ran in
  `packages/dsqlbase/src/client/nodes.ts`
- **Proposal:** `column-hooks.md` (local working artifact, not tracked)

## Context

A `guid()` id needs more than its value: the node its column references, known only once
relations are linked, and, for a belongs-to a union, the row's discriminator. A codec sees one
value. So `createClient` worked out a binding per guid column and overwrote the built column's
readonly `codec` with `Object.defineProperty`, and for a union also installed
`Column.rowDecoder` — which core served through a second read path (`ColumnRowDecoder`,
`Column.resolveRow`, a `MetaResolver` per such column). It also ran its own checks — a ring, two
targets, a guid paired with a plain column, a member reached through no unique key — outside
`validateSchema`, the layer that checks a schema.

Passing the column to the codec was considered and dropped: a definition runs the codec for a
DDL default, where no runtime column exists, so the codec's context would be optional on every
call; and a codec built per column after relations are linked fights the order they are built in.

## Decision

- **A codec is pure.** `ColumnCodec { encode(value), decode(raw) }` is unchanged, and a
  definition still runs it — with the validator — for `.default()`.
- **Column hooks** (`ColumnHooks { read?, write? }`, `ColumnConfig.hooks`) transform values around
  the codec with the context it lacks: `read(value, { column, row })` after decode,
  `write(value, { column })` before encode, on writes and filters. Only the runtime `Column` runs
  them, after references are frozen, so nothing is bound up front.
- **`resolvers/`** in core holds `ColumnCodec`, `ColumnValidator` and `ColumnHooks`: what a definition declares and
  the runtime runs. It is typed with the runtime classes; `definition` imports its types.
- **One read path.** `Column.resolve(raw, row)` decodes, runs the `read` hook with the row, and
  validates, at every level. `ColumnRowDecoder`, `Column.rowDecoder` and `Column.resolveRow` are
  removed. `Column.dependsOn` stays: core still projects the discriminator a hook reads.
- **Generic rules in `validateSchema`:** both columns of a relation pair carry the same hooks
  object; a column with hooks references one target — one column, or one union whose members are
  each reached through a single-column unique key; and no column's references form a ring.
- **`guid()` = a `uuid` codec + `guidHooks`**, one object every guid column shares. Its binding is
  read from `column.resolveReferences()` on first use and kept per built column. `nodes.ts` keeps
  only node discovery.

## Alternatives considered

- **Codec with an optional context** (`encode(value, ctx?)`). Every codec gains an argument it
  rarely uses, and a guid codec must handle "no column" for the DDL default.
- **A codec factory run in `buildSchema`** (`codec: (column) => ColumnCodec`). Resolves the
  binding once, but runs while references are still being linked, and a definition would have no
  codec of its own for its default.
- **Keep the checks in the client.** Leaves a second validation pass outside `validateSchema`;
  phrased over hooks, the rules are generic and need no knowledge of ids.

## Consequences

- No `defineProperty` on a built column; `Column.codec` is the declared one.
- A `SchemaRegistry` built without `createClient` wraps guid ids too, since the hooks travel with
  the column.
- **Breaking (`@dsqlbase/core`):** `ColumnRowDecoder`, `Column.rowDecoder` and
  `Column.resolveRow` are removed; `ColumnCodec` / `defaultCodec` / `ColumnValidator` move from `definition`
  to `resolvers` (still exported from the root); a ring of references is refused for every column —
  a `hasOne` declared from the side that holds the key, beside a relation the other way, now
  fails and should be a `belongsTo`.

## Docs

`docs/internals/codec-boundary.md` (Column hooks), `docs/internals/runtime-pipeline.md` (result
resolvers), `docs/internals/architecture.md` (`resolvers/`, `validation/`, `client/nodes.ts`),
`docs/guide/global-ids.md`.
