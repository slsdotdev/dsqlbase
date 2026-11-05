---
"dsqlbase": patch
---

`guid()` columns wrap and unwrap ids through column hooks instead of a codec swapped onto the built column when the client is created; the column keeps its declared codec. Ids, filters and writes behave as before. A guid paired with a plain column, a guid column referencing two targets, or a polymorphic guid reaching a member through a non-unique column is now refused by schema validation, with reworded messages ("…carry different column hooks…"). A `SchemaRegistry` built without `createClient` now wraps guid ids too.

Docs: docs/internals/codec-boundary.md, docs/guide/global-ids.md, docs/internals/architecture.md
