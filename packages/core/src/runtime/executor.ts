import { Thenable } from "../utils/thenable.js";
import { AnyOperation } from "./operation.js";
import { Session } from "./session.js";

/**
 * Anything a client hands back that runs when awaited, and can be re-bound to another session.
 *
 * `$transaction([...])` batches over this rather than over `ExecutableQuery`, so a result built
 * from several statements batches the same way a single statement does.
 */
export interface Executable<TResult> extends PromiseLike<TResult> {
  execute(): Promise<TResult>;
  clone(session: Session): Executable<TResult>;
}

export class ExecutableQuery<TResult> extends Thenable<TResult> implements Executable<TResult> {
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

type ResultsOf<TParts extends readonly Executable<unknown>[]> = {
  -readonly [K in keyof TParts]: Awaited<TParts[K]>;
};

/**
 * Several executables run together and combined into one result.
 *
 * The parts run concurrently. On a pool session each may take its own connection, so their
 * snapshots can differ; re-bound to a transaction session by `clone`, they share one.
 */
export class CompositeQuery<TParts extends readonly Executable<unknown>[], TResult>
  extends Thenable<TResult>
  implements Executable<TResult>
{
  declare readonly $typeOf: TResult;

  private readonly _parts: TParts;
  private readonly _combine: (results: ResultsOf<TParts>) => TResult;

  constructor(parts: TParts, combine: (results: ResultsOf<TParts>) => TResult) {
    super();

    this._parts = parts;
    this._combine = combine;
  }

  public async execute(): Promise<TResult> {
    const results = await Promise.all(this._parts.map((part) => part.execute()));
    return this._combine(results as ResultsOf<TParts>);
  }

  public clone(session: Session): CompositeQuery<TParts, TResult> {
    const parts = this._parts.map((part) => part.clone(session)) as unknown as TParts;
    return new CompositeQuery(parts, this._combine);
  }
}
