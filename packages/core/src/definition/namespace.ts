import { DefinitionNode, Kind, NodeRef } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { DomainDefinition } from "./domain.js";
import { SequenceDefinition } from "./sequence.js";
import { TableDefinition } from "./table.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNamespaceDefinition = NamespaceDefinition<any>;

export class NamespaceDefinition<TName extends string> extends DefinitionNode<TName> {
  public readonly kind = Kind.SCHEMA;

  public table<TName extends string, TColumns extends Record<string, AnyColumnDefinition>>(
    name: TName,
    columns: TColumns
  ): TableDefinition<TName, TColumns, this> {
    return new TableDefinition(name, { columns, namespace: new NodeRef(this) });
  }

  public domain<TName extends string>(
    name: TName
  ): DomainDefinition<TName, unknown, unknown, this> {
    return new DomainDefinition(name, { namespace: new NodeRef(this) });
  }

  public sequence<TName extends string>(name: TName): SequenceDefinition<TName, this> {
    return new SequenceDefinition(name, { namespace: new NodeRef(this) });
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
    } as const;
  }
}
