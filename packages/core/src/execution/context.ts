import { Session } from "./session.js";

export class ExecutionContext {
  readonly session: Session;

  constructor(session: Session) {
    this.session = session;
  }
}
