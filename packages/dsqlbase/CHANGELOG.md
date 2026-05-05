# dsqlbase

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
