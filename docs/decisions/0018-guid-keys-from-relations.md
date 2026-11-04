# 0018 — `guid()` keys from relations

- **Date:** 2026-11-04
- **Status:** accepted
- **Supersedes:** the key argument of `guid()`, and the rejection of "Inferring the key from
  relations", in [0007](./0007-global-ids.md)
- **Proposal:** `schema-definition-cleanup.md` (local working artifact, not tracked)

## Context

[0007](./0007-global-ids.md) had a relation key column state its target twice: as a string in
`guid("author_id", "authors")`, and again as the relation's target. Only the pair validation
kept the two in step. The string is untyped and names a schema alias, so a re-export silently
changed what it meant. Leaving it off a foreign key made the column a self reference, which was
wrong and still passed validation whenever no relation paired it. 0007 rejected inference
because "a column's wire format would depend on a relation declared elsewhere". In practice the
duplication caused more errors than that dependency would.

## Decision

- `guid(name)` takes no key. What a column's ids name, `(alias, field)`, is resolved when the
  client is built (`resolveBindings` in `packages/dsqlbase/src/client/nodes.ts`). The first
  matching rule applies:
  1. **The `from` of a discriminated `belongsTo`** names whichever member its discriminator says,
     row by row. This is unchanged.
  2. **The key side of a relation pair** names the column it is paired with: the `from` of a
     `belongsTo`, the `to` of a `hasMany` / `hasOne`. For a union target, this is resolved per
     member. The referenced column is resolved by the same rules, so a chain ends at a key.
  3. **Any other column** names its own table and field. A single-column primary key is the
     table's node id, `["photos", {"id": …}]`. An unrelated `photos.ownerId` reads as
     `["photos", {"ownerId": …}]`, which is stable and self-describing but not a node address:
     `$findByGlobalId` refuses a payload whose field is not the node's key.
- **Refused when the client is built:**
  - a column that two relations pair with different targets;
  - columns that reference each other in a ring;
  - a guid paired with a plain uuid (unchanged).
- **A node** is a table whose single guid primary key names itself. Its key is always the schema
  alias, since the explicit override, which doubled as a stable label, is gone. A shared-key
  one-to-one (a primary key that is also a `belongsTo` `from`) is not a node: its ids name the
  row it shares a key with.
- The check that every guid column names an existing node is gone, since rule 3 may name a
  non-node table.

## Consequences

- **Breaking:**
  - The second argument of `guid()` is removed.
  - A foreign key that relied on it needs a relation, which it almost always had already.
  - A non-key column with no relation reads as its own table and field. It used to read as its
    table's primary key, so a self reference now needs its relation.
  - A node can no longer be given a key other than its alias.
  - Changeset level **minor** (0.x).
- Adding a relation to a column that had none changes the wire format of its ids. This is the
  cost 0007 named; it is accepted as part of a schema change.

## Docs

- `docs/guide/`: `global-ids.md`, `schema.md`, `relations.md`, `polymorphic-relations.md`
- `docs/internals/codec-boundary.md`
- `packages/dsqlbase/README.md`
