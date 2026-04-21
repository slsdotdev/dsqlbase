import {
  AddColumnAction,
  AddConstraintSubAction,
  AlterColumnAction,
  AlterDomainCommand,
  AlterIndexCommand,
  AlterSequenceCommand,
  AlterTableCommand,
  CheckConstraintExpression,
  ColumnDefinitionExpression,
  CreateDomainCommand,
  CreateIndexCommand,
  CreateSchemaCommand,
  CreateSequenceCommand,
  CreateTableCommand,
  DropConstraintSubAction,
  DropDefaultSubAction,
  DropDomainCommand,
  DropIdentitySubAction,
  DropIndexCommand,
  DropNotNullSubAction,
  DropSchemaCommand,
  DropSequenceCommand,
  DropTableCommand,
  GeneratedColumnExpression,
  IdentityConstraintExpression,
  IndexColumnExpression,
  PrimaryKeyConstraintExpression,
  RenameColumnAction,
  RenameConstraintAction,
  RenameTableAction,
  RestartSubAction,
  SequenceOptionsExpression,
  SetDataTypeSubAction,
  SetDefaultSubAction,
  SetGeneratedSubAction,
  SetNotNullSubAction,
  SetSchemaAction,
  UniqueConstraintExpression,
  ValidateConstraintSubAction,
} from "./ast.js";

export const createTable = (props: Omit<CreateTableCommand, "__kind">): CreateTableCommand => ({
  __kind: "CREATE_TABLE",
  ...props,
});

export const dropTable = (props: Omit<DropTableCommand, "__kind">): DropTableCommand => ({
  __kind: "DROP_TABLE",
  ...props,
});

export const alterTable = (props: Omit<AlterTableCommand, "__kind">): AlterTableCommand => ({
  __kind: "ALTER_TABLE",
  ...props,
});

export const addColumn = (props: Omit<AddColumnAction, "__kind">): AddColumnAction => ({
  __kind: "ADD_COLUMN",
  ...props,
});

export const rename = (props: Omit<RenameTableAction, "__kind">): RenameTableAction => ({
  __kind: "RENAME",
  ...props,
});

export const renameColumn = (
  props: Omit<RenameColumnAction, "__kind">
): RenameColumnAction => ({
  __kind: "RENAME_COLUMN",
  ...props,
});

export const renameConstraint = (
  props: Omit<RenameConstraintAction, "__kind">
): RenameConstraintAction => ({
  __kind: "RENAME_CONSTRAINT",
  ...props,
});

export const setSchema = (props: Omit<SetSchemaAction, "__kind">): SetSchemaAction => ({
  __kind: "SET_SCHEMA",
  ...props,
});

export const createIndex = (props: Omit<CreateIndexCommand, "__kind">): CreateIndexCommand => ({
  __kind: "CREATE_INDEX",
  ...props,
});

export const dropIndex = (props: Omit<DropIndexCommand, "__kind">): DropIndexCommand => ({
  __kind: "DROP_INDEX",
  ...props,
});

export const alterIndex = (props: Omit<AlterIndexCommand, "__kind">): AlterIndexCommand => ({
  __kind: "ALTER_INDEX",
  ...props,
});

export const createSchema = (props: Omit<CreateSchemaCommand, "__kind">): CreateSchemaCommand => ({
  __kind: "CREATE_SCHEMA",
  ...props,
});

export const dropSchema = (props: Omit<DropSchemaCommand, "__kind">): DropSchemaCommand => ({
  __kind: "DROP_SCHEMA",
  ...props,
});

export const sequenceOptions = (
  props: Omit<SequenceOptionsExpression, "__kind">
): SequenceOptionsExpression => ({
  __kind: "SEQUENCE_OPTIONS",
  ...props,
});

export const createSequence = (
  props: Omit<CreateSequenceCommand, "__kind">
): CreateSequenceCommand => ({
  __kind: "CREATE_SEQUENCE",
  ...props,
});

export const dropSequence = (props: Omit<DropSequenceCommand, "__kind">): DropSequenceCommand => ({
  __kind: "DROP_SEQUENCE",
  ...props,
});

export const alterSequence = (
  props: Omit<AlterSequenceCommand, "__kind">
): AlterSequenceCommand => ({
  __kind: "ALTER_SEQUENCE",
  ...props,
});

export const createDomain = (props: Omit<CreateDomainCommand, "__kind">): CreateDomainCommand => ({
  __kind: "CREATE_DOMAIN",
  ...props,
});

export const dropDomain = (props: Omit<DropDomainCommand, "__kind">): DropDomainCommand => ({
  __kind: "DROP_DOMAIN",
  ...props,
});

export const identity = (
  props: Omit<IdentityConstraintExpression, "__kind">
): IdentityConstraintExpression => ({
  __kind: "IDENTITY_CONSTRAINT",
  ...props,
});

export const generated = (
  props: Omit<GeneratedColumnExpression, "__kind">
): GeneratedColumnExpression => ({
  __kind: "GENERATED_EXPRESSION",
  ...props,
});

export const alterColumn = (props: Omit<AlterColumnAction, "__kind">): AlterColumnAction => ({
  __kind: "ALTER_COLUMN",
  ...props,
});

export const alterDomain = (props: Omit<AlterDomainCommand, "__kind">): AlterDomainCommand => ({
  __kind: "ALTER_DOMAIN",
  ...props,
});

export const setNotNull = (): SetNotNullSubAction => ({ __kind: "SET_NOT_NULL" });
export const dropNotNull = (): DropNotNullSubAction => ({ __kind: "DROP_NOT_NULL" });
export const setDefault = (props: Omit<SetDefaultSubAction, "__kind">): SetDefaultSubAction => ({
  __kind: "SET_DEFAULT",
  ...props,
});
export const dropDefault = (): DropDefaultSubAction => ({ __kind: "DROP_DEFAULT" });
export const setDataType = (props: Omit<SetDataTypeSubAction, "__kind">): SetDataTypeSubAction => ({
  __kind: "SET_DATA_TYPE",
  ...props,
});
export const setGenerated = (
  props: Omit<SetGeneratedSubAction, "__kind">
): SetGeneratedSubAction => ({ __kind: "SET_GENERATED", ...props });
export const restart = (props: Omit<RestartSubAction, "__kind"> = {}): RestartSubAction => ({
  __kind: "RESTART",
  ...props,
});
export const dropIdentity = (
  props: Omit<DropIdentitySubAction, "__kind"> = {}
): DropIdentitySubAction => ({ __kind: "DROP_IDENTITY", ...props });
export const addConstraint = (
  props: Omit<AddConstraintSubAction, "__kind">
): AddConstraintSubAction => ({ __kind: "ADD_CONSTRAINT", ...props });
export const dropConstraint = (
  props: Omit<DropConstraintSubAction, "__kind">
): DropConstraintSubAction => ({ __kind: "DROP_CONSTRAINT", ...props });
export const validateConstraint = (
  props: Omit<ValidateConstraintSubAction, "__kind">
): ValidateConstraintSubAction => ({ __kind: "VALIDATE_CONSTRAINT", ...props });

export const column = (
  props: Omit<ColumnDefinitionExpression, "__kind">
): ColumnDefinitionExpression => ({
  __kind: "COLUMN_DEFINITION",
  ...props,
});

export const check = (
  props: Omit<CheckConstraintExpression, "__kind">
): CheckConstraintExpression => ({
  __kind: "CHECK_CONSTRAINT",
  ...props,
});

export const primaryKey = (
  props: Omit<PrimaryKeyConstraintExpression, "__kind">
): PrimaryKeyConstraintExpression => ({
  __kind: "PRIMARY_KEY_CONSTRAINT",
  ...props,
});

export const unique = (
  props: Omit<UniqueConstraintExpression, "__kind">
): UniqueConstraintExpression => ({
  __kind: "UNIQUE_CONSTRAINT",
  ...props,
});

export const indexColumn = (
  props: Omit<IndexColumnExpression, "__kind">
): IndexColumnExpression => ({
  __kind: "INDEX_COLUMN",
  ...props,
});

export const ddl = {
  createTable,
  dropTable,
  alterTable,
  addColumn,
  rename,
  renameColumn,
  renameConstraint,
  setSchema,
  createIndex,
  dropIndex,
  alterIndex,
  createSchema,
  dropSchema,
  sequenceOptions,
  createSequence,
  dropSequence,
  alterSequence,
  createDomain,
  dropDomain,
  identity,
  generated,
  alterColumn,
  alterDomain,
  setNotNull,
  dropNotNull,
  setDefault,
  dropDefault,
  setDataType,
  setGenerated,
  restart,
  dropIdentity,
  addConstraint,
  dropConstraint,
  validateConstraint,
  column,
  check,
  primaryKey,
  unique,
  indexColumn,
};
