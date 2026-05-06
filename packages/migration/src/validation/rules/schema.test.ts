import { AnyNamespaceDefinition } from "@dsqlbase/core/definition";
import { describe, expect, it } from "vitest";
import { SerializedObject } from "../../base.js";
import { ValidationContext } from "../context.js";
import { reservedNamespace } from "./schema.js";

type Schema = SerializedObject<AnyNamespaceDefinition>;

const schemaNode = (name: string): Schema => ({ kind: "SCHEMA", name }) as Schema;

describe("reservedNamespace", () => {
  it("does not report user-defined namespaces", () => {
    const node = schemaNode("billing");
    const context = new ValidationContext([node]);
    reservedNamespace(node, context);
    expect(context.issues).toEqual([]);
  });

  it.each(["pg_catalog", "pg_toast", "information_schema", "sys", "pg_anything"])(
    "reports reserved namespace %s",
    (name) => {
      const node = schemaNode(name);
      const context = new ValidationContext([node]);
      reservedNamespace(node, context);
      expect(context.issues).toHaveLength(1);
      expect(context.issues[0]?.code).toBe("RESERVED_NAMESPACE");
    }
  );
});
