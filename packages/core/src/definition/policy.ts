import { PolicyExpressionResolver } from "../resolvers/policy.js";
import { DefinitionNode, Kind } from "./base.js";
import { AnyTableDefinition } from "./table.js";

/** A statement a policy applies to — PostgreSQL's `FOR` commands, `ALL` aside. */
export type PolicyCommand = "select" | "insert" | "update" | "delete";

/** What `for` accepts: one command, `"all"`, or several. */
export type PolicyFor = "all" | PolicyCommand;

export type PolicyConfig<TTable extends AnyTableDefinition> = {
  table: TTable;
  as?: "permissive" | "restrictive";
  for?: PolicyFor | readonly PolicyFor[];
  using?: PolicyExpressionResolver<TTable>;
  check?: PolicyExpressionResolver<TTable>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPolicyDefinition = PolicyDefinition<any, any>;

export class PolicyDefinition<
  TName extends string,
  TTable extends AnyTableDefinition,
> extends DefinitionNode<TName, PolicyConfig<TTable>> {
  public readonly kind = Kind.POLICY;

  protected _table: TTable;
  protected _as: "permissive" | "restrictive";
  protected _for: PolicyFor | readonly PolicyFor[];
  protected _using?: PolicyExpressionResolver<TTable>;
  protected _check?: PolicyExpressionResolver<TTable>;

  constructor(name: TName, config: PolicyConfig<TTable>) {
    super(name);

    this._table = config.table;
    this._as = config.as ?? "permissive";
    this._for = config.for ?? "all";
    this._using = config.using;
    this._check = config.check;
  }

  public as(as: "permissive" | "restrictive") {
    this._as = as;
    return this;
  }

  public for(value: PolicyFor | readonly PolicyFor[]) {
    this._for = value;
    return this;
  }

  public using(using: PolicyExpressionResolver<TTable>) {
    this._using = using;
    return this;
  }

  public check(check: PolicyExpressionResolver<TTable>) {
    this._check = check;
    return this;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      as: this._as,
      for: this._for,
    } as const;
  }
}
