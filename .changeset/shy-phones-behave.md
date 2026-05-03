---
"dsqlbase": minor
---

**Query client and schema migration runner:**

Added:

- schema objects definition support for `namespace`, `table`, `domain`, and `sequence`;
- schema migrations runner via introspection -> reconcile;
- model client with crud operations factories for `create`, `findOne`, `findMany`, `update`, `delete`;
- sql tag with filter expressions, `sql.in, sql.eq, ...`;
