import { settings, uuid } from "dsqlbase/schema";

/**
 * The per-request values the workspace tables read: each fills its `workspace_id` on insert and
 * bounds every read and write through its policy. Its own module, not the schema's: settings
 * are not schema objects, and `createClient({ schema })` and the migration runner take only
 * definitions.
 */
export const params = settings({
  workspaceId: uuid("identity.workspace_id"),
  userId: uuid("identity.user_id"),
});
