import { DefinitionNode } from "@dsqlbase/core/definition";
import { GlobalRule, Rule } from "../context.js";

const MAX_IDENTIFIER_BYTES = 63;

export const noDuplicateObjectNames: GlobalRule = (definition, context) => {
  const nameByNamespace = new Map<string, Set<string>>(
    Array.from(context.namespaces.keys()).map((namespace) => [namespace, new Set<string>()])
  );

  for (const obj of definition) {
    if (obj.kind === "SCHEMA") {
      continue;
    }

    const namespace = obj.namespace ?? "public";

    if (!nameByNamespace.has(namespace)) {
      nameByNamespace.set(namespace, new Set<string>());
    }

    const names = nameByNamespace.get(namespace);

    if (names?.has(obj.name)) {
      context.report({
        level: "error",
        code: "DUPLICATE_OBJECT_NAME",
        message: `Duplicate object name found: ${obj.name} in namespace: ${namespace}`,
        path: [namespace, obj.name],
      });
    }

    names?.add(obj.name);
  }
};

export const identifierTooLong: Rule<DefinitionNode> = (node, context) => {
  const bytes = Buffer.byteLength(node.name, "utf8");
  if (bytes <= MAX_IDENTIFIER_BYTES) return;

  context.report({
    level: "error",
    code: "IDENTIFIER_TOO_LONG",
    message: `Identifier "${node.name}" is ${bytes} bytes; PostgreSQL limits identifiers to ${MAX_IDENTIFIER_BYTES} bytes.`,
    path: [node.name],
  });
};
