export type DDLCommand =
  | "CREATE_TABLE"
  | "ALTER_TABLE"
  | "DROP_TABLE"
  | "CREATE_SCHEMA"
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
  | "SET_SCHEMA";

export type DDLExpression =
  | "COLUMN_DEFINITION"
  | "CHECK_CONSTRAINT"
  | "PRIMARY_KEY_CONSTRAINT"
  | "UNIQUE_CONSTRAINT"
  | "INDEX_COLUMN";

export type DDLKind = DDLCommand | DDLAction | DDLExpression;

export interface DDLStatement {
  __kind: DDLKind;
}

export interface CheckConstraintExpression extends DDLStatement {
  __kind: "CHECK_CONSTRAINT";
  name: string;
  expression: string;
}

export interface PrimaryKeyConstraintExpression extends DDLStatement {
  __kind: "PRIMARY_KEY_CONSTRAINT";
  name?: string;
  columns: string[];
  include?: string[] | null;
}

export interface UniqueConstraintExpression extends DDLStatement {
  __kind: "UNIQUE_CONSTRAINT";
  name?: string;
  columns: string[];
  include?: string[] | null;
  nullsDistinct?: boolean | null;
}

export interface IndexColumnExpression extends DDLStatement {
  __kind: "INDEX_COLUMN";
  columnName: string;
  sortDirection?: "ASC" | "DESC";
  nulls?: "FIRST" | "LAST";
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

export type TableConstraintExpression =
  | PrimaryKeyConstraintExpression
  | UniqueConstraintExpression
  | CheckConstraintExpression;

export interface CreateTableCommand extends DDLStatement {
  __kind: "CREATE_TABLE";
  name: string;
  ifNotExists?: boolean;
  columns?: ColumnDefinitionExpression[];
  constraints?: TableConstraintExpression[];
}

export interface DropTableCommand extends DDLStatement {
  __kind: "DROP_TABLE";
  name: string;
  ifExists?: boolean;
}

export interface AddColumnAction extends DDLStatement {
  __kind: "ADD_COLUMN";
  column: ColumnDefinitionExpression;
  ifNotExists?: boolean;
}

export type AnyAlterTableAction = AddColumnAction;

export interface AlterTableCommand extends DDLStatement {
  __kind: "ALTER_TABLE";
  name: string;
  actions: AnyAlterTableAction[];
}

export interface CreateIndexCommand extends DDLStatement {
  __kind: "CREATE_INDEX";
  name: string;
  tableName: string;
  columns: IndexColumnExpression[];
  unique?: boolean;
  async?: boolean;
  ifNotExists?: boolean;
  include?: string[];
  nullsDistinct?: boolean;
}

export interface DropIndexCommand extends DDLStatement {
  __kind: "DROP_INDEX";
  name: string;
  ifExists?: boolean;
}

export type AnyDDLStatement =
  | CreateTableCommand
  | DropTableCommand
  | AlterTableCommand
  | CreateIndexCommand
  | DropIndexCommand
  | AddColumnAction
  | ColumnDefinitionExpression
  | CheckConstraintExpression
  | PrimaryKeyConstraintExpression
  | UniqueConstraintExpression
  | IndexColumnExpression;

export const isStatement = (obj: unknown): obj is DDLStatement => {
  if (obj == null) return false;
  if (typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((c) => isStatement(c));
  return "__kind" in obj && typeof obj.__kind === "string";
};
