import { DefinitionNode, Kind } from "./base.js";

export class SequenceDefinition<TName extends string> extends DefinitionNode<TName> {
  public readonly kind = Kind.SEQUENCE;
}
