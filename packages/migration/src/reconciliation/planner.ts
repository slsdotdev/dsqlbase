import { DefinitionNode } from "@dsqlbase/core/definition";
import { SerializedObject } from "../base.js";
import { IndexedDDLOperation, qualifiedConstraintName, qualifiedName } from "./operations/index.js";

const CONSTRAINT_KINDS = new Set([
  "PRIMARY_KEY_CONSTRAINT",
  "UNIQUE_CONSTRAINT",
  "CHECK_CONSTRAINT",
]);

function isConstraintObject(obj: SerializedObject<DefinitionNode>): boolean {
  return CONSTRAINT_KINDS.has(obj.kind);
}

/**
 * The subject string is the key other ops use in their `references[]` to
 * point at this op. For most ops that's `qualifiedName(object)`. For
 * standalone constraint ops (today only the UNIQUE promotion path), the
 * parent table is the first entry of `references[]`.
 */
function subjectOf(op: IndexedDDLOperation): string {
  if (isConstraintObject(op.object)) {
    const parent = op.references?.[0];

    if (parent !== undefined) {
      return qualifiedConstraintName(parent, op.object);
    }
  }

  return qualifiedName(op.object);
}

function insertSorted(arr: number[], value: number): void {
  let lo = 0;
  let hi = arr.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }

  arr.splice(lo, 0, value);
}

function buildSubjectRegistry(ops: IndexedDDLOperation[]): Map<string, number[]> {
  const registry = new Map<string, number[]>();

  for (const op of ops) {
    const subject = subjectOf(op);
    const list = registry.get(subject);

    if (list) {
      list.push(op.id);
    } else {
      registry.set(subject, [op.id]);
    }
  }

  return registry;
}

interface DependencyGraph {
  /** adjacency.get(a) = set of b such that a -> b (a must come before b) */
  adjacency: Map<number, Set<number>>;
  inDegree: Map<number, number>;
}

function buildDependencyGraph(
  ops: IndexedDDLOperation[],
  registry: Map<string, number[]>
): DependencyGraph {
  const adjacency = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();

  for (const op of ops) {
    inDegree.set(op.id, 0);
  }

  const addEdge = (from: number, to: number) => {
    if (from === to) return;
    let outs = adjacency.get(from);

    if (!outs) {
      outs = new Set();
      adjacency.set(from, outs);
    }

    if (!outs.has(to)) {
      outs.add(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  };

  for (const op of ops) {
    const refs = op.references ?? [];

    for (const ref of refs) {
      const refIds = registry.get(ref);
      if (!refIds) continue;

      for (const refId of refIds) {
        if (op.type === "DROP") {
          // DROP X must come before ops that touch X's referenced subjects.
          addEdge(op.id, refId);
        } else {
          // CREATE/ALTER X must come after ops that touch X's referenced subjects.
          addEdge(refId, op.id);
        }
      }
    }
  }

  return { adjacency, inDegree };
}

export function planOperations(ops: IndexedDDLOperation[]): IndexedDDLOperation[] {
  const opsById = new Map(ops.map((op) => [op.id, op] as const));
  const registry = buildSubjectRegistry(ops);
  const { adjacency, inDegree } = buildDependencyGraph(ops, registry);

  // Kahn's algorithm with a stable min-id ordering of the ready set.
  const ready: number[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.push(id);
  }

  ready.sort((a, b) => a - b);

  const result: IndexedDDLOperation[] = [];

  while (ready.length > 0) {
    const id = ready.shift() as number;
    const op = opsById.get(id);

    if (!op) continue;
    result.push(op);

    const outs = adjacency.get(id);
    if (!outs) continue;

    for (const next of outs) {
      const newDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) insertSorted(ready, next);
    }
  }

  if (result.length !== ops.length) {
    const remaining = ops.filter((op) => !result.includes(op)).map((op) => op.id);

    throw new Error(
      `Cycle detected in DDL operation dependencies (op ids: ${remaining.join(", ")}). ` +
        `This indicates a bug in operation emission, not user input.`
    );
  }

  return result;
}
