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

export type DDLSubAction =
  | "SET_NOT_NULL"
  | "DROP_NOT_NULL"
  | "SET_DEFAULT"
  | "DROP_DEFAULT"
  | "SET_DATA_TYPE"
  | "SET_GENERATED"
  | "RESTART"
  | "DROP_IDENTITY"
  | "ADD_CONSTRAINT"
  | "DROP_CONSTRAINT"
  | "VALIDATE_CONSTRAINT";

export type DDLExpression =
  | "COLUMN_DEFINITION"
  | "CHECK_CONSTRAINT"
  | "PRIMARY_KEY_CONSTRAINT"
  | "UNIQUE_CONSTRAINT"
  | "INDEX_COLUMN"
  | "SEQUENCE_OPTIONS"
  | "IDENTITY_CONSTRAINT"
  | "GENERATED_EXPRESSION";

export type DDLKind = DDLCommand | DDLAction | DDLSubAction | DDLExpression;

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

export interface IdentityConstraintExpression extends DDLStatement {
  __kind: "IDENTITY_CONSTRAINT";
  mode: "ALWAYS" | "BY_DEFAULT";
  options?: SequenceOptionsExpression;
}

export interface GeneratedColumnExpression extends DDLStatement {
  __kind: "GENERATED_EXPRESSION";
  expression: string;
  stored: true;
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
  identity?: IdentityConstraintExpression;
  generated?: GeneratedColumnExpression;
}

export type TableConstraintExpression =
  | PrimaryKeyConstraintExpression
  | UniqueConstraintExpression
  | CheckConstraintExpression;

export interface CreateTableCommand extends DDLStatement {
  __kind: "CREATE_TABLE";
  name: string;
  schema?: string;
  ifNotExists?: boolean;
  columns?: ColumnDefinitionExpression[];
  constraints?: TableConstraintExpression[];
}

export interface DropTableCommand extends DDLStatement {
  __kind: "DROP_TABLE";
  name: string;
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}

export interface AddColumnAction extends DDLStatement {
  __kind: "ADD_COLUMN";
  column: ColumnDefinitionExpression;
  ifNotExists?: boolean;
}

export interface RenameTableAction extends DDLStatement {
  __kind: "RENAME";
  newName: string;
}

export interface RenameColumnAction extends DDLStatement {
  __kind: "RENAME_COLUMN";
  columnName: string;
  newName: string;
}

export interface RenameConstraintAction extends DDLStatement {
  __kind: "RENAME_CONSTRAINT";
  constraintName: string;
  newName: string;
}

export interface SetSchemaAction extends DDLStatement {
  __kind: "SET_SCHEMA";
  schemaName: string;
}

export type AnyAlterTableAction =
  | AddColumnAction
  | AlterColumnAction
  | RenameTableAction
  | RenameColumnAction
  | RenameConstraintAction
  | SetSchemaAction;

export interface AlterTableCommand extends DDLStatement {
  __kind: "ALTER_TABLE";
  name: string;
  schema?: string;
  actions: AnyAlterTableAction[];
}

export interface CreateIndexCommand extends DDLStatement {
  __kind: "CREATE_INDEX";
  name: string;
  tableName: string;
  tableSchema?: string;
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
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}

export interface CreateSchemaCommand extends DDLStatement {
  __kind: "CREATE_SCHEMA";
  name: string;
  ifNotExists?: boolean;
}

export interface DropSchemaCommand extends DDLStatement {
  __kind: "DROP_SCHEMA";
  name: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}

export interface SequenceOptionsExpression extends DDLStatement {
  __kind: "SEQUENCE_OPTIONS";
  dataType?: string;
  startValue?: number;
  incrementBy?: number;
  minValue?: number;
  maxValue?: number;
  cache?: number;
  cycle?: boolean;
  ownedBy?: string;
}

export interface CreateSequenceCommand extends DDLStatement {
  __kind: "CREATE_SEQUENCE";
  name: string;
  schema?: string;
  ifNotExists?: boolean;
  options?: SequenceOptionsExpression;
}

export interface DropSequenceCommand extends DDLStatement {
  __kind: "DROP_SEQUENCE";
  name: string;
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}

export interface AlterSequenceCommand extends DDLStatement {
  __kind: "ALTER_SEQUENCE";
  name: string;
  schema?: string;
  options?: SequenceOptionsExpression;
  restart?: { with?: number };
}

export interface CreateDomainCommand extends DDLStatement {
  __kind: "CREATE_DOMAIN";
  name: string;
  schema?: string;
  dataType: string;
  notNull?: boolean;
  defaultValue?: string;
  check?: CheckConstraintExpression;
  ifNotExists?: boolean;
}

export interface DropDomainCommand extends DDLStatement {
  __kind: "DROP_DOMAIN";
  name: string;
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}

export interface SetNotNullSubAction extends DDLStatement {
  __kind: "SET_NOT_NULL";
}

export interface DropNotNullSubAction extends DDLStatement {
  __kind: "DROP_NOT_NULL";
}

export interface SetDefaultSubAction extends DDLStatement {
  __kind: "SET_DEFAULT";
  expression: string;
}

export interface DropDefaultSubAction extends DDLStatement {
  __kind: "DROP_DEFAULT";
}

export interface SetDataTypeSubAction extends DDLStatement {
  __kind: "SET_DATA_TYPE";
  dataType: string;
  using?: string;
}

export interface SetGeneratedSubAction extends DDLStatement {
  __kind: "SET_GENERATED";
  mode: "ALWAYS" | "BY_DEFAULT";
  options?: SequenceOptionsExpression;
}

export interface RestartSubAction extends DDLStatement {
  __kind: "RESTART";
  with?: number;
}

export interface DropIdentitySubAction extends DDLStatement {
  __kind: "DROP_IDENTITY";
  ifExists?: boolean;
}

export interface AddConstraintSubAction extends DDLStatement {
  __kind: "ADD_CONSTRAINT";
  constraint: CheckConstraintExpression;
}

export interface DropConstraintSubAction extends DDLStatement {
  __kind: "DROP_CONSTRAINT";
  name: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}

export interface ValidateConstraintSubAction extends DDLStatement {
  __kind: "VALIDATE_CONSTRAINT";
  name: string;
}

type SharedModifySubAction =
  | SetNotNullSubAction
  | DropNotNullSubAction
  | SetDefaultSubAction
  | DropDefaultSubAction;

export type AlterColumnSubAction =
  | SharedModifySubAction
  | SetDataTypeSubAction
  | SetGeneratedSubAction
  | RestartSubAction
  | DropIdentitySubAction;

export type AlterDomainSubAction =
  | SharedModifySubAction
  | AddConstraintSubAction
  | DropConstraintSubAction
  | ValidateConstraintSubAction;

export interface AlterColumnAction extends DDLStatement {
  __kind: "ALTER_COLUMN";
  columnName: string;
  actions: AlterColumnSubAction[];
}

export interface AlterDomainCommand extends DDLStatement {
  __kind: "ALTER_DOMAIN";
  name: string;
  schema?: string;
  action: AlterDomainSubAction;
}

export type AlterIndexAction = RenameTableAction | SetSchemaAction;

export interface AlterIndexCommand extends DDLStatement {
  __kind: "ALTER_INDEX";
  name: string;
  schema?: string;
  ifExists?: boolean;
  action: AlterIndexAction;
}

export type AnyDDLStatement =
  | CreateTableCommand
  | DropTableCommand
  | AlterTableCommand
  | CreateIndexCommand
  | DropIndexCommand
  | CreateSchemaCommand
  | DropSchemaCommand
  | SequenceOptionsExpression
  | CreateSequenceCommand
  | DropSequenceCommand
  | AlterSequenceCommand
  | CreateDomainCommand
  | DropDomainCommand
  | AddColumnAction
  | RenameTableAction
  | RenameColumnAction
  | RenameConstraintAction
  | SetSchemaAction
  | ColumnDefinitionExpression
  | CheckConstraintExpression
  | PrimaryKeyConstraintExpression
  | UniqueConstraintExpression
  | IndexColumnExpression
  | IdentityConstraintExpression
  | GeneratedColumnExpression
  | AlterColumnAction
  | AlterDomainCommand
  | AlterIndexCommand
  | SetNotNullSubAction
  | DropNotNullSubAction
  | SetDefaultSubAction
  | DropDefaultSubAction
  | SetDataTypeSubAction
  | SetGeneratedSubAction
  | RestartSubAction
  | DropIdentitySubAction
  | AddConstraintSubAction
  | DropConstraintSubAction
  | ValidateConstraintSubAction;

export const isStatement = (obj: unknown): obj is DDLStatement => {
  if (obj == null) return false;
  if (typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((c) => isStatement(c));
  return "__kind" in obj && typeof obj.__kind === "string";
};
