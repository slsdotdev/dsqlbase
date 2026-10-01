export { sql, SQLQuery, TenancyError } from "@dsqlbase/core";
export type { Session, SQLStatement } from "@dsqlbase/core";
export {
  GLOBAL_ID_PREFIX,
  GlobalIdError,
  decodeGlobalId,
  encodeGlobalId,
  isGlobalId,
  type GlobalId,
  type GlobalIdErrorCode,
} from "./schema/utils/global-id.js";
export {
  ColumnValidationError,
  type ColumnValidationErrorCode,
} from "./schema/utils/column-validation.js";
export {
  CURSOR_PREFIX,
  InvalidCursorError,
  type InvalidCursorCode,
} from "./client/pagination/cursor.js";
export {
  createClient,
  type ClaimsOf,
  type ClientOptions,
  type IdentityClient,
  type QueryClient,
} from "./client/index.js";
