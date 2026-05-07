# dsqlbase

## 0.1.3

### Patch Changes

- f40df61: fix columns type exports
  - @dsqlbase/core@0.1.3

## 0.1.2

### Patch Changes

- 96b7e7d: package cleanup
- Updated dependencies [96b7e7d]
  - @dsqlbase/core@0.1.2

## 0.1.1

### Patch Changes

- 57c5e9e: connector session factories
- 4f4ecdd: internal packages restructure
  - @dsqlbase/core@0.1.1

## 0.1.0

### Minor Changes

- 66d5d93: **Query client and schema migration runner:**

  Added:
  - schema objects definition support for `namespace`, `table`, `domain`, and `sequence`;
  - schema migrations runner via introspection -> reconcile;
  - model client with crud operations factories for `create`, `findOne`, `findMany`, `update`, `delete`;
  - sql tag with filter expressions, `sql.in, sql.eq, ...`;

### Patch Changes

- @dsqlbase/client@0.1.0
- @dsqlbase/core@0.1.0
- @dsqlbase/schema@0.1.0
