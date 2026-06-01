export interface OCCRetryOptions {
  maxRetries?: number;
  delay?: number;
  maxDelay?: number;
}

export function backoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const delay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.1;
  return Math.min(delay + jitter, maxDelay);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isOccError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "40001";
}
