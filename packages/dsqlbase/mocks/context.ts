import { ExecutionContext, QueryBuilder, Schema, SchemaRegistry } from "@dsqlbase/core";
import { MockSession } from "./session.js";

import * as schema from "./schema.js";
import { withModels } from "../src/client/clients/base.js";
import { DsqlClient } from "../src/client/clients/dsql.js";

export { schema };

export const registry = new SchemaRegistry(schema);
export const dialect = new QueryBuilder();
export const session = new MockSession();

export type MockSchema = Schema<typeof schema>;

export const context = new ExecutionContext({
  schema: registry,
  dialect,
  session: session,
});

export const dsql = withModels<typeof schema, DsqlClient<typeof schema>>(new DsqlClient(context));
