---
"dsqlbase": patch
---

`numeric()` takes a `mode`: `"number"` (the default, unchanged), `"string"` for the exact decimal text, or a decimal class such as decimal.js's `Decimal`, `Big` or `BigNumber`, whose instances reads return. Values past a double's precision now read back exactly. In `"string"` and class modes a write also accepts a `string` or `number`, and a string that is not a decimal number is refused; precision and scale are checked in every mode. Filters take the read type. New exported types: `NumericMode`, `NumericOptions`, `DecimalLike`, `DecimalConstructor`, `NumericValueType`, `NumericInputType`.

Docs: docs/guide/schema.md, docs/guide/querying.md, docs/internals/codec-boundary.md, docs/decisions/0016-numeric-modes.md
