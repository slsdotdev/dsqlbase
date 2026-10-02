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

/**
 * An identity column's explicit sequence name creates a relation in the table's namespace, so it
 * must be free there: not another identity's, not a sequence's, a table's or an index's. Only
 * explicit names are checked — Postgres picks a free one for an identity that names none.
 */
export const duplicateSequenceName: GlobalRule = (definition, context) => {
  const taken = new Map<string, Map<string, string>>();
  const owners = (namespace: string) => {
    if (!taken.has(namespace)) {
      taken.set(namespace, new Map());
    }

    return taken.get(namespace) as Map<string, string>;
  };

  for (const obj of definition) {
    if (obj.kind === "SCHEMA") {
      continue;
    }

    const names = owners(obj.namespace ?? "public");
    names.set(obj.name, `${obj.kind.toLowerCase()} "${obj.name}"`);

    if (obj.kind === "TABLE") {
      for (const index of obj.indexes ?? []) {
        names.set(index.name, `index "${index.name}"`);
      }
    }
  }

  for (const obj of definition) {
    if (obj.kind !== "TABLE") {
      continue;
    }

    const namespace = obj.namespace ?? "public";
    const names = owners(namespace);

    for (const column of obj.columns) {
      const sequenceName = column.identity?.sequenceName;

      if (!sequenceName) {
        continue;
      }

      const owner = `identity column "${obj.name}"."${column.name}"`;
      const existing = names.get(sequenceName);

      if (existing !== undefined) {
        context.report({
          level: "error",
          code: "DUPLICATE_SEQUENCE_NAME",
          message:
            `Sequence name "${sequenceName}" of ${owner} is already used by ${existing} ` +
            `in namespace: ${namespace}`,
          path: [namespace, obj.name, "columns", column.name],
          hint: `An identity's sequence is a relation in its table's namespace; give it a free name or none.`,
        });
      }

      names.set(sequenceName, owner);
    }
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
