import { ExecutionContext, QueryBuilder, SchemaRegistry } from "@dsqlbase/core";
import { MockSession } from "./session.js";

import * as schema from "./schema.js";

export const registry = new SchemaRegistry(schema);
export const dialect = new QueryBuilder();
export const session = new MockSession();
export { schema };

export const context = new ExecutionContext({
  schema: registry,
  dialect,
  session: session,
});
