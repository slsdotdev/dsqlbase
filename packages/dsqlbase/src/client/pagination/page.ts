import type { PagePlan } from "../model/normalizer.js";
import { encodeCursor } from "./cursor.js";

/** A page before `totalCount` is attached. */
export type Page<TItem> = {
  items: TItem[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

type ResolvedRecord = Record<string, unknown> & { $$meta: Record<string, unknown> };

/**
 * Turns the rows of a keyset select into a page.
 *
 * The select read one row more than the page holds, so whether another page follows in the
 * direction of travel is whether that row came back. It is dropped before resolving. Each kept
 * row's cursor is built from its hidden `__k<n>` columns — the database's own text — which the
 * resolver never sees, so they are read off the raw rows here.
 */
export function shapePage(
  rows: unknown[],
  resolve: (rows: unknown[]) => unknown,
  plan: PagePlan
): Page<ResolvedRecord> {
  const more = rows.length > plan.take;
  const kept = (more ? rows.slice(0, plan.take) : rows) as Record<string, unknown>[];
  const records = resolve(kept) as ResolvedRecord[];

  const items = records.map((record, index) => {
    const values = plan.keys.map((_, key) => kept[index][`__k${key}`] as string | null);
    const cursor = encodeCursor(plan.signature, values);

    // `$$meta` is the table's frozen, shared meta object: copied, never written to.
    return { ...record, $$meta: { ...record.$$meta, cursor } };
  });

  // `before` is only ever the bound when a cursor was passed with it.
  const backward = plan.bound === "before";

  // Read backwards, the page arrives nearest-the-cursor first; put it back in order.
  if (backward) {
    items.reverse();
  }

  // Only the direction of travel is known exactly. The other side is known to hold at least
  // the cursor row whenever a cursor was passed.
  const hasCursor = plan.cursor !== undefined;

  return {
    items,
    hasNextPage: backward ? hasCursor : more,
    hasPreviousPage: backward ? more : hasCursor,
    startCursor: (items[0]?.$$meta.cursor as string | undefined) ?? null,
    endCursor: (items.at(-1)?.$$meta.cursor as string | undefined) ?? null,
  };
}
