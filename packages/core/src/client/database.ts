import { QueryClient } from "./base.js";

export class DatabaseClient extends QueryClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $transaction<T>(fn: (tx: QueryClient) => Promise<T>): Promise<T> {
    throw new Error("Method not implemented.");
  }
}
