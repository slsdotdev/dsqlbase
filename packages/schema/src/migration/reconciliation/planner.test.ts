import { describe, expect, it } from "vitest";
import { DefinitionNode } from "@dsqlbase/core/definition";
import { SerializedObject } from "../base.js";
import { DDLStatement } from "../ddl/index.js";
import { DDLOperationType, IndexedDDLOperation } from "./operations/index.js";
import { planOperations } from "./planner.js";

const stubStatement = { __kind: "CREATE_TABLE" } as DDLStatement;

interface MakeOpArgs {
  id: number;
  type: DDLOperationType;
  kind?: string;
  name: string;
  namespace?: string;
  references?: string[];
}

function makeOp(args: MakeOpArgs): IndexedDDLOperation {
  const object = {
    kind: args.kind ?? "TABLE",
    name: args.name,
    ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
  } as unknown as SerializedObject<DefinitionNode>;

  return {
    id: args.id,
    type: args.type,
    object,
    statement: stubStatement,
    references: args.references,
  };
}

const idsOf = (ops: IndexedDDLOperation[]) => ops.map((op) => op.id);

describe("planOperations", () => {
  it("orders CREATE op after the op that emits its referenced subject", () => {
    const indexOp = makeOp({
      id: 0,
      type: "CREATE",
      kind: "INDEX",
      name: "users_email_idx",
      references: ["users"],
    });
    const tableOp = makeOp({ id: 1, type: "CREATE", kind: "TABLE", name: "users" });

    const result = planOperations([indexOp, tableOp]);

    expect(idsOf(result)).toEqual([1, 0]);
  });

  it("orders DROP op before the op that emits its referenced subject", () => {
    const dropTable = makeOp({ id: 0, type: "DROP", kind: "TABLE", name: "users" });
    const dropIndex = makeOp({
      id: 1,
      type: "DROP",
      kind: "INDEX",
      name: "users_email_idx",
      references: ["users"],
    });

    const result = planOperations([dropTable, dropIndex]);

    expect(idsOf(result)).toEqual([1, 0]);
  });

  it("resolves transitive dependencies", () => {
    const a = makeOp({ id: 0, type: "CREATE", kind: "TABLE", name: "A", references: ["B"] });
    const b = makeOp({ id: 1, type: "CREATE", kind: "TABLE", name: "B", references: ["C"] });
    const c = makeOp({ id: 2, type: "CREATE", kind: "TABLE", name: "C" });

    const result = planOperations([a, b, c]);

    expect(idsOf(result)).toEqual([2, 1, 0]);
  });

  it("orders schema before a namespaced object that references it", () => {
    const tableOp = makeOp({
      id: 0,
      type: "CREATE",
      kind: "TABLE",
      name: "users",
      namespace: "app",
      references: ["app"],
    });
    const schemaOp = makeOp({ id: 1, type: "CREATE", kind: "SCHEMA", name: "app" });

    const result = planOperations([tableOp, schemaOp]);

    expect(idsOf(result)).toEqual([1, 0]);
  });

  it("orders domain creation before an ALTER TABLE that references it", () => {
    const alterTableOp = makeOp({
      id: 0,
      type: "ALTER",
      kind: "TABLE",
      name: "users",
      references: ["email_addr"],
    });
    const domainOp = makeOp({ id: 1, type: "CREATE", kind: "DOMAIN", name: "email_addr" });

    const result = planOperations([alterTableOp, domainOp]);

    expect(idsOf(result)).toEqual([1, 0]);
  });

  it("orders the UNIQUE promotion chain: table -> index -> constraint", () => {
    // Emission order: [constraint (refs table+index), index (refs table), table].
    // Planner should produce [table, index, constraint].
    const constraintOp = makeOp({
      id: 0,
      type: "CREATE",
      kind: "UNIQUE_CONSTRAINT",
      name: "users_email_key",
      references: ["users", "users_email_key_idx"],
    });
    const indexOp = makeOp({
      id: 1,
      type: "CREATE",
      kind: "INDEX",
      name: "users_email_key_idx",
      references: ["users"],
    });
    const tableOp = makeOp({ id: 2, type: "CREATE", kind: "TABLE", name: "users" });

    const result = planOperations([constraintOp, indexOp, tableOp]);

    expect(idsOf(result)).toEqual([2, 1, 0]);
  });

  it("preserves emission order between multiple ALTERs on the same subject", () => {
    const alter1 = makeOp({ id: 0, type: "ALTER", kind: "TABLE", name: "users" });
    const alter2 = makeOp({ id: 1, type: "ALTER", kind: "TABLE", name: "users" });
    const alter3 = makeOp({ id: 2, type: "ALTER", kind: "TABLE", name: "users" });

    const result = planOperations([alter1, alter2, alter3]);

    expect(idsOf(result)).toEqual([0, 1, 2]);
  });

  it("preserves emission order for ops with no dependencies", () => {
    const dropOldIndex = makeOp({
      id: 0,
      type: "DROP",
      kind: "INDEX",
      name: "old_idx",
      references: ["other_table"],
    });
    const newTable = makeOp({ id: 1, type: "CREATE", kind: "TABLE", name: "fresh_table" });

    const result = planOperations([dropOldIndex, newTable]);

    expect(idsOf(result)).toEqual([0, 1]);
  });

  it("scopes constraint subjects per parent table to avoid name collisions", () => {
    // Two tables with same constraint name. Each constraint references its own
    // table; planner must not entangle them via the shared constraint name.
    const tableA = makeOp({ id: 0, type: "CREATE", kind: "TABLE", name: "A" });
    const tableB = makeOp({ id: 1, type: "CREATE", kind: "TABLE", name: "B" });
    const constraintA = makeOp({
      id: 2,
      type: "CREATE",
      kind: "UNIQUE_CONSTRAINT",
      name: "shared_key",
      references: ["A"],
    });
    const constraintB = makeOp({
      id: 3,
      type: "CREATE",
      kind: "UNIQUE_CONSTRAINT",
      name: "shared_key",
      references: ["B"],
    });

    const result = planOperations([constraintA, constraintB, tableA, tableB]);

    // Tables come first (constraints depend on them), then constraints in stable order.
    expect(idsOf(result)).toEqual([0, 1, 2, 3]);
  });

  it("throws when references form a cycle", () => {
    const a = makeOp({ id: 0, type: "CREATE", kind: "TABLE", name: "A", references: ["B"] });
    const b = makeOp({ id: 1, type: "CREATE", kind: "TABLE", name: "B", references: ["A"] });

    expect(() => planOperations([a, b])).toThrow(/Cycle detected/);
  });
});
