import { Session } from "@dsqlbase/core/runtime";
import { SerializedSchema, sortSchemaObjects } from "../base.js";
import { normalizeObject, RawSchemaObject } from "./normalizer.js";
import { introspection } from "./query.js";

export interface IntrospectionResult {
  definitions: RawSchemaObject[] | null;
}

export async function introspect(session: Session): Promise<SerializedSchema> {
  const [result] = await session.execute<IntrospectionResult>(introspection.toQuery());
  const objects: SerializedSchema = [];

  for (const raw of result?.definitions ?? []) {
    const normalized = normalizeObject(raw);
    if (normalized) objects.push(normalized);
  }

  return sortSchemaObjects(objects);
}
