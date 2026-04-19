export type DDLCommand =
  | "CREATE_TABLE"
  | "ALTER_TABLE"
  | "DROP_TABLE"
  | "CREATE_SCHEMA"
  | "ALTER_SCHEMA"
  | "DROP_SCHEMA"
  | "CREATE_DOMAIN"
  | "ALTER_DOMAIN"
  | "DROP_DOMAIN"
  | "CREATE_SEQUENCE"
  | "ALTER_SEQUENCE"
  | "DROP_SEQUENCE"
  | "CREATE_VIEW"
  | "ALTER_VIEW"
  | "DROP_VIEW"
  | "CREATE_INDEX"
  | "ALTER_INDEX"
  | "DROP_INDEX"
  | "CREATE_FUNCTION"
  | "ALTER_FUNCTION"
  | "DROP_FUNCTION";

export type DDLAction =
  | "RENAME"
  | "OWNER"
  | "ADD_COLUMN"
  | "ALTER_COLUMN"
  | "RENAME_COLUMN"
  | "RENAME_CONSTRAINT"
  | "ADD_CONSTRAINT"
  | "DROP_CONSTRAINT"
  | "SET_SCHEMA";

export type DDLExpression = "COLUMN_DEFINITION" | "CHECK_CONSTRAINT";

export type DDLKind = DDLCommand | DDLAction | DDLExpression;

export interface DDLStatement {
  __kind: DDLKind;
}

export interface CheckConstraintExpression extends DDLStatement {
  __kind: "CHECK_CONSTRAINT";
  name: string;
  expression: string;
}

export interface ColumnDefinitionExpression extends DDLStatement {
  __kind: "COLUMN_DEFINITION";
  name: string;
  dataType: string;
  notNull: boolean;
  isPrimaryKey: boolean;
  unique: boolean;
  defaultValue: string | null;
  check?: CheckConstraintExpression;
}

export interface CreateTableCommand extends DDLStatement {
  __kind: "CREATE_TABLE";
  name: string;
  ifNotExists?: boolean;
  columns?: ColumnDefinitionExpression[];
}

export type AnyDDLStatement =
  | CreateTableCommand
  | ColumnDefinitionExpression
  | CheckConstraintExpression;

export const isStatement = (obj: unknown): obj is DDLStatement => {
  if (obj == null) return false;
  if (typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((c) => isStatement(c));
  return "_operation" in obj && typeof obj._operation === "string";
};
