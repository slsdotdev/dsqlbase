import { PGlite } from "@electric-sql/pglite";
import { Schema } from "@dsqlbase/core/runtime";
import { createClient } from "dsqlbase";
import { createPgLiteSession } from "dsqlbase/pglite";
import { schema } from "./schema";

export const createTestClient = () => {
  const pg = new PGlite("memory://", { debug: 0 });

  const session = createPgLiteSession(pg);
  const dsql = createClient({ schema, session });

  return Object.assign(dsql, { session, pg, close: () => pg.close() });
};

export type ClientSchema = Schema<typeof schema>;
export type TestClient = ReturnType<typeof createTestClient>;
