import { PGlite } from "@electric-sql/pglite";
import { Schema } from "@dsqlbase/core/runtime";
import { createClient } from "dsqlbase";
import { createPgLiteSession } from "dsqlbase/pglite";
import { schema } from "./schema";

export interface TestClientOptions {
  /**
   * Whether tenant tables refuse to build a query on a client with no claims. Defaults to the
   * library default, which is `true`.
   */
  enforceTenancy?: boolean;
}

export const createTestClient = (options: TestClientOptions = {}) => {
  const pg = new PGlite("memory://", { debug: 0 });

  const session = createPgLiteSession(pg);
  const dsql = createClient({
    schema,
    session,
    tenancy: { enforce: options.enforceTenancy ?? true },
  });

  return Object.assign(dsql, { session, pg, close: () => pg.close() });
};

export type ClientSchema = Schema<typeof schema>;
export type TestClient = ReturnType<typeof createTestClient>;
