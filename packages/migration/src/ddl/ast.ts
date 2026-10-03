// VIEW and FUNCTION kinds are reserved for future stories — no statement types, factories, or printer cases exist for them yet.
export type DDLCommand =
  | "BACKFILL"
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
  | "DROP_COLUMN"
  | "ALTER_COLUMN"
  | "RENAME_COLUMN"
  | "RENAME_CONSTRAINT"
  | "SET_SCHEMA"
  | "ADD_CONSTRAINT_USING_INDEX";

export type DDLSubAction =
  | "SET_NOT_NULL"
  | "DROP_NOT_NULL"
  | "SET_DEFAULT"
  | "DROP_DEFAULT"
  | "SET_DATA_TYPE"
  | "ADD_IDENTITY"
  | "SET_GENERATED"
  | "RESTART"
  | "DROP_IDENTITY"
  | "ADD_CONSTRAINT"
  | "DROP_CONSTRAINT"
  | "VALIDATE_CONSTRAINT"
  | "DROP_EXPRESSION"
  | "SET_SEQUENCE_OPTIONS";

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

export type DDLStatement = {
  __kind: DDLKind;
};

export type CheckConstraintExpression = {
  __kind: "CHECK_CONSTRAINT";
  name: string;
  expression: string;
} & DDLStatement;

export type PrimaryKeyConstraintExpression = {
  __kind: "PRIMARY_KEY_CONSTRAINT";
  name?: string;
  columns: string[];
  include?: string[] | null;
} & DDLStatement;

export type UniqueConstraintExpression = {
  __kind: "UNIQUE_CONSTRAINT";
  name?: string;
  columns: string[];
  include?: string[] | null;
  nullsDistinct?: boolean | null;
} & DDLStatement;

export type IndexColumnExpression = {
  __kind: "INDEX_COLUMN";
  columnName: string;
  nulls?: "FIRST" | "LAST";
} & DDLStatement;

export type IdentityConstraintExpression = {
  __kind: "IDENTITY_CONSTRAINT";
  mode: "ALWAYS" | "BY_DEFAULT";
  options?: SequenceOptionsExpression;
} & DDLStatement;

export type GeneratedColumnExpression = {
  __kind: "GENERATED_EXPRESSION";
  expression: string;
  stored: true;
} & DDLStatement;

export type ColumnDefinitionExpression = {
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
} & DDLStatement;

export type TableConstraintExpression =
  | PrimaryKeyConstraintExpression
  | UniqueConstraintExpression
  | CheckConstraintExpression;

export type CreateTableCommand = {
  __kind: "CREATE_TABLE";
  name: string;
  schema?: string;
  ifNotExists?: boolean;
  columns?: ColumnDefinitionExpression[];
  constraints?: TableConstraintExpression[];
} & DDLStatement;

export type DropTableCommand = {
  __kind: "DROP_TABLE";
  name: string;
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
} & DDLStatement;

export type AddColumnAction = {
  __kind: "ADD_COLUMN";
  column: ColumnDefinitionExpression;
  ifNotExists?: boolean;
} & DDLStatement;

export type DropColumnAction = {
  __kind: "DROP_COLUMN";
  columnName: string;
  ifExists?: boolean;
} & DDLStatement;

/**
 * Fills a column's NULLs with its default, in batches: `UPDATE … SET c = DEFAULT` on up to
 * `batchSize` rows at a time, picked by primary key. Not DDL: the executor repeats it, one
 * transaction per batch, until a batch updates nothing.
 */
export type BackfillCommand = {
  __kind: "BACKFILL";
  tableName: string;
  schema?: string;
  columnName: string;
  /** The primary-key columns batches are picked by. */
  key: string[];
  batchSize: number;
} & DDLStatement;

export type RenameTableAction = {
  __kind: "RENAME";
  newName: string;
} & DDLStatement;

export type RenameColumnAction = {
  __kind: "RENAME_COLUMN";
  columnName: string;
  newName: string;
} & DDLStatement;

export type RenameConstraintAction = {
  __kind: "RENAME_CONSTRAINT";
  constraintName: string;
  newName: string;
} & DDLStatement;

export type SetSchemaAction = {
  __kind: "SET_SCHEMA";
  schemaName: string;
} & DDLStatement;

export type OwnerAction = {
  __kind: "OWNER";
  roleName: string;
} & DDLStatement;

export type AddConstraintUsingIndexAction = {
  __kind: "ADD_CONSTRAINT_USING_INDEX";
  name: string;
  kind: "UNIQUE" | "PRIMARY_KEY";
  indexName: string;
} & DDLStatement;

export type AnyAlterTableAction =
  | AddColumnAction
  | DropColumnAction
  | AlterColumnAction
  | AddConstraintSubAction
  | DropConstraintSubAction
  | ValidateConstraintSubAction
  | RenameTableAction
  | RenameColumnAction
  | RenameConstraintAction
  | SetSchemaAction
  | OwnerAction
  | AddConstraintUsingIndexAction;

export type AlterTableCommand = {
  __kind: "ALTER_TABLE";
  name: string;
  schema?: string;
  /** `ALTER TABLE ASYNC`: DSQL's form for `VALIDATE CONSTRAINT`, which runs as a job. */
  async?: boolean;
  actions: AnyAlterTableAction[];
} & DDLStatement;

export type CreateIndexCommand = {
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
} & DDLStatement;

export type DropIndexCommand = {
  __kind: "DROP_INDEX";
  name: string;
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
} & DDLStatement;

export type CreateSchemaCommand = {
  __kind: "CREATE_SCHEMA";
  name: string;
  ifNotExists?: boolean;
} & DDLStatement;

export type DropSchemaCommand = {
  __kind: "DROP_SCHEMA";
  name: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
} & DDLStatement;

export type SequenceOptionsExpression = {
  __kind: "SEQUENCE_OPTIONS";
  /** `SEQUENCE NAME`: an identity column's sequence only. */
  sequenceName?: string;
  dataType?: string;
  startValue?: number;
  incrementBy?: number;
  minValue?: number;
  maxValue?: number;
  cache?: number;
  cycle?: boolean;
  ownedBy?: string;
} & DDLStatement;

export type CreateSequenceCommand = {
  __kind: "CREATE_SEQUENCE";
  name: string;
  schema?: string;
  ifNotExists?: boolean;
  options?: SequenceOptionsExpression;
} & DDLStatement;

export type DropSequenceCommand = {
  __kind: "DROP_SEQUENCE";
  name: string;
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
} & DDLStatement;

export type AlterSequenceCommand = {
  __kind: "ALTER_SEQUENCE";
  name: string;
  schema?: string;
  options?: SequenceOptionsExpression;
  restart?: { with?: number };
} & DDLStatement;

export type CreateDomainCommand = {
  __kind: "CREATE_DOMAIN";
  name: string;
  schema?: string;
  dataType: string;
  notNull?: boolean;
  defaultValue?: string;
  check?: CheckConstraintExpression;
  ifNotExists?: boolean;
} & DDLStatement;

export type DropDomainCommand = {
  __kind: "DROP_DOMAIN";
  name: string;
  schema?: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
} & DDLStatement;

export type SetNotNullSubAction = {
  __kind: "SET_NOT_NULL";
} & DDLStatement;

export type DropNotNullSubAction = {
  __kind: "DROP_NOT_NULL";
} & DDLStatement;

export type SetDefaultSubAction = {
  __kind: "SET_DEFAULT";
  expression: string;
} & DDLStatement;

export type DropDefaultSubAction = {
  __kind: "DROP_DEFAULT";
} & DDLStatement;

export type SetDataTypeSubAction = {
  __kind: "SET_DATA_TYPE";
  dataType: string;
  using?: string;
} & DDLStatement;

export type SetGeneratedSubAction = {
  __kind: "SET_GENERATED";
  mode: "ALWAYS" | "BY_DEFAULT";
  options?: SequenceOptionsExpression;
} & DDLStatement;

export type RestartSubAction = {
  __kind: "RESTART";
  with?: number;
} & DDLStatement;

export type AddIdentitySubAction = {
  __kind: "ADD_IDENTITY";
  mode: "ALWAYS" | "BY_DEFAULT";
  options?: SequenceOptionsExpression;
} & DDLStatement;

export type DropIdentitySubAction = {
  __kind: "DROP_IDENTITY";
  ifExists?: boolean;
} & DDLStatement;

export type AddConstraintSubAction = {
  __kind: "ADD_CONSTRAINT";
  constraint: CheckConstraintExpression;
  /** Skips checking existing rows; DSQL requires it on an existing table. */
  notValid?: boolean;
} & DDLStatement;

export type DropConstraintSubAction = {
  __kind: "DROP_CONSTRAINT";
  name: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
} & DDLStatement;

export type ValidateConstraintSubAction = {
  __kind: "VALIDATE_CONSTRAINT";
  name: string;
} & DDLStatement;

type SharedModifySubAction =
  | SetNotNullSubAction
  | DropNotNullSubAction
  | SetDefaultSubAction
  | DropDefaultSubAction;

/** `DROP EXPRESSION`: a generated column becomes a plain one, keeping its values. */
export type DropExpressionSubAction = {
  __kind: "DROP_EXPRESSION";
} & DDLStatement;

/** An identity's sequence options, as `SET INCREMENT BY 5 SET CACHE 1 …`. */
export type SetSequenceOptionsSubAction = {
  __kind: "SET_SEQUENCE_OPTIONS";
  incrementBy?: number;
  minValue?: number;
  maxValue?: number;
  startValue?: number;
  cache?: number;
  cycle?: boolean;
} & DDLStatement;

export type AlterColumnSubAction =
  | SharedModifySubAction
  | DropExpressionSubAction
  | SetSequenceOptionsSubAction
  | SetDataTypeSubAction
  | AddIdentitySubAction
  | SetGeneratedSubAction
  | RestartSubAction
  | DropIdentitySubAction;

export type AlterDomainSubAction =
  | SharedModifySubAction
  | AddConstraintSubAction
  | DropConstraintSubAction
  | ValidateConstraintSubAction;

export type AlterColumnAction = {
  __kind: "ALTER_COLUMN";
  columnName: string;
  actions: AlterColumnSubAction[];
} & DDLStatement;

export type AlterDomainCommand = {
  __kind: "ALTER_DOMAIN";
  name: string;
  schema?: string;
  action: AlterDomainSubAction;
} & DDLStatement;

// Intentionally limited to rename + schema move: PG cannot alter an index's column list (drop + recreate instead) and indexes have no separate owner.
export type AlterIndexAction = RenameTableAction | SetSchemaAction;

export type AlterIndexCommand = {
  __kind: "ALTER_INDEX";
  name: string;
  schema?: string;
  ifExists?: boolean;
  action: AlterIndexAction;
} & DDLStatement;

export type AnyDDLStatement =
  | BackfillCommand
  | DropColumnAction
  | DropExpressionSubAction
  | SetSequenceOptionsSubAction
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
  | OwnerAction
  | AddConstraintUsingIndexAction
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
  | AddIdentitySubAction
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
