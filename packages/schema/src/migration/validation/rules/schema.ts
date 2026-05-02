import { AnyNamespaceDefinition } from "@dsqlbase/core/definition";
import { Rule } from "../context.js";

const RESERVED_NAMESPACES = new Set(["pg_catalog", "pg_toast", "information_schema", "sys"]);

export const reservedNamespace: Rule<AnyNamespaceDefinition> = (schema, context) => {
  if (!RESERVED_NAMESPACES.has(schema.name) && !schema.name.startsWith("pg_")) return;

  context.report({
    level: "error",
    code: "RESERVED_NAMESPACE",
    message: `Schema name "${schema.name}" is reserved by PostgreSQL.`,
    path: [schema.name],
  });
};
