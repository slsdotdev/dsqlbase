import { DefinitionNode, Kind } from "./base.js";

export class ViewDefinition<TName extends string> extends DefinitionNode<TName> {
  public readonly kind = Kind.VIEW;

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
    } as const;
  }
}
