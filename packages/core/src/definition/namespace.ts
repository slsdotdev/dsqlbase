import { WithNamespace } from "../utils/index.js";
import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { TableDefinition } from "./table.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNamespaceDefinition = NamespaceDefinition<any>;

export class NamespaceDefinition<TName extends string> extends DefinitionNode<TName> {
  public readonly kind = Kind.SCHEMA;

  public table<TName extends string, TColumns extends Record<string, AnyColumnDefinition>>(
    name: TName,
    columns: TColumns
  ): WithNamespace<TableDefinition<TName, TColumns, this>, this> {
    return new TableDefinition(name, { columns, schema: this }) as WithNamespace<
      TableDefinition<TName, TColumns, this>,
      this
    >;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
    } as const;
  }
}
