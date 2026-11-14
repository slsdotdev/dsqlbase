export { sql, SQLQuery, PolicyViolationError } from "@dsqlbase/core";
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
export { createClient, type ClientOptions } from "./client/index.js";
