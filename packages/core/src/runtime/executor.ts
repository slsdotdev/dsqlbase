import { Thenable } from "../utils/thenable.js";
import { AnyOperation } from "./operation.js";
import { Session } from "./session.js";

export class ExecutableQuery<TResult> extends Thenable<TResult> {
  declare readonly $typeOf: TResult;

  private readonly _operation: AnyOperation;
  private readonly _session: Session;

  constructor(operation: AnyOperation, session: Session) {
    super();

    this._operation = operation;
    this._session = session;
  }

  public async execute(): Promise<TResult> {
    const result = await this._session.execute(this._operation.query);
    return this._operation.resolve(result) as TResult;
  }

  public clone(session: Session): ExecutableQuery<TResult> {
    return new ExecutableQuery(this._operation, session);
  }
}
