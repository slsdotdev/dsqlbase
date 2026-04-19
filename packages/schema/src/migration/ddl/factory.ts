import { ColumnDefinitionExpression, CreateTableCommand } from "./ast.js";

export const createTable = (props: Omit<CreateTableCommand, "__kind">): CreateTableCommand => ({
  __kind: "CREATE_TABLE",
  ...props,
});

export const column = (
  props: Omit<ColumnDefinitionExpression, "__kind">
): ColumnDefinitionExpression => ({
  __kind: "COLUMN_DEFINITION",
  ...props,
});

export const ddl = {
  createTable,
  column,
};
