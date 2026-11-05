# 0019 — Declared union columns

- **Date:** 2026-11-04
- **Status:** accepted
- **Supersedes:** how shared fields are defined, and the rejection of "A declared shared-field
  list on `union()`", in [0009](./0009-polymorphic-relations.md)
- **Proposal:** `schema-definition-cleanup.md` (local working artifact, not tracked)

## Context

[0009](./0009-polymorphic-relations.md) derived a union's shared fields as the intersection of
member fields with the same data type. That had three problems:

- What a union exposed was implicit, and changed when a member gained a column.
- A field whose type differed on one member silently dropped out.
- One shared field could be stored under a different column name on each member.

It also hid a bug. A union's `id` is a different node on each member, so filtering it by a
global id passed the id to every member's branch. The other members' codecs then refused it:
`posts.findOne({ where: { id: { eq: photoId } } })` threw `key_mismatch` instead of reading
the photo.

## Decision

- **`union(members, columns)`**: the second argument is required. It declares the shared fields
  as columns: `union({ photos, videos }, { id: guid("id"), userId: guid("user_id") })`.
- **Each declared field is resolved to the member column under the same field.** `union()`
  throws unless that column, on every member, has:
  - the same database name;
  - the same data type;
  - the same column kind (prototype), so a `guid()` is not a `uuid()`;
  - `NOT NULL`, wherever the declaration is.
- **Typing.** Declaring a field some member lacks is a type error. `union.columns`, and the
  shared `select` / `where` / `orderBy` types, come from the declaration.
- **Relations.** A relation's `to` takes declared columns. The per-member `to` map stays for a
  key the members store under different fields.
- **Global ids in a shared `where` are decided per member** (`WhereBuilder._foldGlobalIds`, next
  to the `$$key` fold):
  - `eq` with an id naming another node than the member's column prunes that branch;
  - `in` keeps only the matching ids, and prunes the branch when none are left;
  - `neq` with such an id becomes `exists`;
  - raw uuids pass through.

## Consequences

- **Breaking:**
  - `union()` needs its columns.
  - A shared field stored under two column names is no longer shared: rename the column, or
    use the per-member `to` map.
  - `SharedFieldsOf` is gone from `@dsqlbase/core`; `CommonFieldsOf` and `UnionColumnsConfig`
    replace it.
  - The client's union types take the union definition instead of its members.
  - Changeset level **minor** (0.x).
- A global id selects its own member on a union read and a union join, so
  `$findByGlobalId`-style lookups work through the union client too.

## Docs

- `docs/guide/`: `schema.md`, `polymorphic-relations.md`, `relations.md`
- `docs/internals/`: `runtime-pipeline.md`, `architecture.md`
- `packages/dsqlbase/README.md`
