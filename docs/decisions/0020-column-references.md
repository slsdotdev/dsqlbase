# 0020 — Column references

- **Date:** 2026-11-05
- **Status:** accepted
- **Supersedes:** how [0018](./0018-guid-keys-from-relations.md) resolves bindings (the client's
  own walk over every relation); the required discriminator on a belongs-to a union in
  [0009](./0009-polymorphic-relations.md)
- **Proposal:** `column-references.md` (local working artifact, not tracked)

## Context

The client (`packages/dsqlbase/src/client/nodes.ts`) worked out what every `guid()` column points
at by walking every relation itself (`resolveBindings`, `collectReferences`,
`collectDynamicColumns`, `targetColumnLists`, `validateRelationPairs`), and stamped the result
onto core's built columns as `defineProperty` symbols. It was hard to follow and crossed the
boundary: a relational fact, "this foreign key points at X", was re-derived outside the layer
that owns relations. Core already visits every pair while validating relations, including the
per-member pairs of a union, and runtime columns already belong to one client, so the fact could
live there with no new traversal and no leak between clients.

A union could also not be the source of a relation (`posts` has many `comments`), and a
belongs-to a union required a stored discriminator.

## Decision

- **A runtime `Column` records its references** (`Column.references`,
  `packages/core/src/runtime/reference.ts`), set by `SchemaRegistry` while it validates
  relations, for every column type, and frozen once the registry is built. References sit on the
  foreign key, as in SQL: the `from` of a belongs-to, the `to` of a has-many / has-one. A
  reference declared from both sides is recorded once.
- **Two kinds.** `table` points at one column. `union` points at a member's column chosen per
  row by a discriminator — a stored column, or a `ComputedDiscriminator` when the relation
  declares none.
- **Core follows chains; the client decides conflicts.** `resolveReferences(row?)` walks table
  references to where each chain ends and reports a ring, never throwing: a plain key may point
  at two tables. A column holds a list of references, compared by where they end, so
  `orders.customerId` → `customers.id` and → `customerStats.customerId` → `customers.id` agree.
  The client refuses two different ends, a ring, or a guid paired with a plain column, for a
  `guid()` column only.
- **`Column.dependsOn`** (the discriminator of each union reference) is projected by core
  whenever the column is selected, for every column type. `ColumnRowDecoder.dependsOn` is gone.
- **Shared-key one-to-one** keeps 0018's behaviour: `profiles.id` follows its reference and reads
  as a users id; such a table is not meant as a standalone node.
- **A belongs-to a union may omit its discriminator.** The member is then computed when the
  query runs: `CASE WHEN EXISTS (SELECT 1 FROM <member> WHERE <key> = <fk>) THEN '<alias>' …
  END`, in member order, projected as `"<fk>$key"`. A join correlates each branch on the same
  expression, so a key two members hold joins the first, as the id reads. A write has nothing to
  fill; a member's id is unwrapped. A discriminator is still refused on a has-many / has-one.
- **`relations()` takes a union as its source.** Every member gets the relation from its own
  column, so joins from a union branch, or from a member alone, are ordinary table joins; the
  union client's shared `join` / `select` take them. The target must be a table. The foreign key
  of a has-many / has-one from a union gets one `union` reference with a computed discriminator,
  so `reaction.postId === reaction.post.id` holds without anything stored to say which member.
- **Out of scope:** the codec. The client still installs the guid `codec` and `rowDecoder` on the
  built column; that is its own redesign.

## Alternatives considered

- **Wrap a union-source key with the union's alias** (`["posts", { id }]`). Cheaper — no probe —
  but `$findByGlobalId` would have to treat a union as a node and query every member, an id in
  two members becomes ambiguous, and `reaction.postId === reaction.post.id` breaks.
- **Return a union-source key raw, or refuse `guid()` there.** Gives up the equality global ids
  exist for.
- **The client walks `references` itself.** Keeps core a plain data holder, but every consumer
  re-implements the walk and the ring detection, which are relational rather than guid concerns.
- **Gate `dependsOn` projection on column type.** Saves a column for a plain-`uuid` belongs-to a
  union, but makes projection depend on what the client installs. Projection is core's decision.

## Consequences

- `nodes.ts` reduces to reading references, a pair check over every column, and node discovery.
- **Cost of a computed discriminator:** one key lookup per member for every row read. It suits a
  few members; a stored discriminator costs nothing. The probe reads members without their tenant
  predicate — it only names which member holds a key the row already carries.
- Joins stay relation-driven: a has-many join starts on the source table while its reference sits
  on the target.
- **Breaking (`@dsqlbase/core`):** `ColumnRowDecoder.dependsOn` is removed; a plain-`uuid`
  belongs-to a union now also selects its discriminator.

## Docs

`docs/internals/runtime-pipeline.md` (Column references, Union joins),
`docs/internals/codec-boundary.md`, `docs/internals/architecture.md`,
`docs/guide/polymorphic-relations.md`, `docs/guide/relations.md`, `docs/guide/global-ids.md`.
