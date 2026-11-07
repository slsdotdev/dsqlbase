import { AnyColumnDefinition, SettingsDefinition } from "@dsqlbase/core/definition";

/**
 * Declares the per-request values row policies and `$onCreate` read. Each is a column builder:
 * its name is the key a native policy would read through `current_setting()`, its type and codec
 * type and encode the value. Hand the result to `createClient({ settings })`; give values per
 * request with `dsql.$settings({ ... })`; read one in a policy through `settings`, as a table's
 * columns are read through `columns`. An unset setting renders `NULL`.
 *
 * Settings are not schema objects: no DDL, nothing for migrations to diff.
 *
 * @example
 * ```ts
 * export const params = settings({
 *   userId: uuid("identity.user_id"),
 *   workspaceId: uuid("identity.workspace_id"),
 * });
 *
 * users.policy("own", (t) => ({ using: sql`${t.id} = ${params.settings.userId}` }));
 *
 * const db = dsql.$settings({ userId: jwt.sub, workspaceId: jwt.ws });
 * ```
 */
export function settings<TColumns extends Record<string, AnyColumnDefinition>>(columns: TColumns) {
  return new SettingsDefinition(columns);
}
