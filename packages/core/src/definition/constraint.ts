import { SQLQuery } from "../sql/nodes.js";
import { DefinitionNode, Kind } from "./base.js";

export interface ConstraintConfig {
  expression: SQLQuery;
}

export type AnyCheckConstraintDefinition = CheckConstraintDefinition<string, ConstraintConfig>;

export class CheckConstraintDefinition<
  TName extends string,
  TConfig extends ConstraintConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.CHECK_CONSTRAINT;

  declare readonly __type: TConfig;

  protected _expression: TConfig["expression"];

  constructor(name: TName, config: TConfig) {
    super(name);

    this._expression = config.expression;
  }

  toJSON() {
    const { text } = this._expression.toQuery({ inlineParams: true });

    return {
      kind: this.kind,
      name: this.name,
      expression: text,
    };
  }
}
