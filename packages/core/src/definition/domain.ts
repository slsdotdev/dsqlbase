import { NotNull } from "../utils/index.js";
import { DefinitionNode, Kind } from "./base.js";

export interface DomainConfig {
  // Placeholder for future domain configuration options
  notNull: boolean;
  constraintName?: string;
}

export type AnyDomainDefinition = DomainDefinition<string, DomainConfig>;

export class DomainDefinition<
  TName extends string,
  TConfig extends DomainConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.DOMAIN;

  declare readonly __type: TConfig;

  protected _notNull: boolean;
  protected _constraintName?: string;

  constructor(name: TName, config: Partial<TConfig>) {
    super(name);

    this._notNull = config.notNull ?? false;
    this._constraintName = config.constraintName;
  }

  public notNull(): NotNull<this> {
    this._notNull = true;
    return this as NotNull<this>;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      notNull: this._notNull,
      constraintName: this._constraintName,
    };
  }
}
