import {
  AddColumnAction,
  AlterTableCommand,
  CheckConstraintExpression,
  ColumnDefinitionExpression,
  CreateIndexCommand,
  CreateTableCommand,
  DropIndexCommand,
  DropTableCommand,
  IndexColumnExpression,
  PrimaryKeyConstraintExpression,
  UniqueConstraintExpression,
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

export const createIndex = (props: Omit<CreateIndexCommand, "__kind">): CreateIndexCommand => ({
  __kind: "CREATE_INDEX",
  ...props,
});

export const dropIndex = (props: Omit<DropIndexCommand, "__kind">): DropIndexCommand => ({
  __kind: "DROP_INDEX",
  ...props,
});

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
  createIndex,
  dropIndex,
  column,
  check,
  primaryKey,
  unique,
  indexColumn,
};
