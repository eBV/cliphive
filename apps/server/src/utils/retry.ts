export interface RetryOptions {
  attempts: number;
  delayMs: number;
  backoff: "linear" | "exponential";
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { attempts, delayMs, backoff, onRetry } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === attempts) break;

      const delay =
        backoff === "exponential"
          ? delayMs * Math.pow(2, attempt - 1)
          : delayMs * attempt;

      onRetry?.(attempt, err);

      console.warn(
        `[Retry] Attempt ${attempt}/${attempts} failed. Retrying in ${delay}ms…`,
        (err as Error).message
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Circuit breaker implementation
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: number | null = null;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly maxFailures: number = 5,
    private readonly resetTimeoutMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (
        this.lastFailureTime !== null &&
        Date.now() - this.lastFailureTime > this.resetTimeoutMs
      ) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is OPEN — service unavailable");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures += 1;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.maxFailures) {
      this.state = "open";
      console.error(
        `[CircuitBreaker] OPENED after ${this.failures} consecutive failures`
      );
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.lastFailureTime = null;
    this.state = "closed";
  }
}
