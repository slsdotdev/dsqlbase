import { AnyColumnDefinition, TenantScopeDefinition } from "@dsqlbase/core/definition";

/**
 * Declares a tenant boundary as a set of claim columns.
 *
 * Every table built with the returned scope carries those columns, filled by the runtime from
 * the identity on the client and AND-ed into every read as a predicate. They are system-managed:
 * readable, selectable, filterable and orderable, but never writable through `create` or
 * `update`.
 *
 * @param claims The claim columns, keyed by the claim name. Each must be `notNull` — the
 * runtime fills it on every insert, so it is never absent.
 *
 * @example
 * ```ts
 * const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });
 *
 * // sugar: the claim columns are merged in
 * const invoices = ws.table("invoices", {
 *   id: uuid("id").primaryKey().defaultRandom(),
 *   number: text("number").notNull(),
 * });
 *
 * // or spread them, for any other constructor
 * const audit = namespace("app").table("audit", {
 *   ...ws.columns(),
 *   id: uuid("id").primaryKey().defaultRandom(),
 * });
 * ```
 */
export function tenantScope<TClaims extends Record<string, AnyColumnDefinition>>(
  claims: TClaims,
  name?: string
): TenantScopeDefinition<TClaims> {
  return new TenantScopeDefinition(claims, name);
}
