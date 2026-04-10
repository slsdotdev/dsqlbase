import { DefinitionNode, Kind } from "./base.js";

export class Sequence<TName extends string> extends DefinitionNode<TName> {
  public readonly kind = Kind.SEQUENCE;
}
