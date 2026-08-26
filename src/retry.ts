export interface RetryContext {
  attempt: number;
  retry: number;
  delayMs: number;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (error: unknown, context: RetryContext) => void | Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
}

export class RetryLimitError extends Error {
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super(`operation failed after ${attempts} attempts`, { cause });
    this.name = 'RetryLimitError';
    this.attempts = attempts;
  }
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries));
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;

  for (let retry = 0; ; retry += 1) {
    try {
      return await operation();
    } catch (error) {
      const attempts = retry + 1;
      if (options.shouldRetry && !options.shouldRetry(error)) throw error;
      if (retry >= maxRetries) throw new RetryLimitError(attempts, error);

      const delayMs = Math.min(
        Math.max(0, options.baseDelayMs) * 2 ** retry,
        maxDelayMs,
      );
      await options.onRetry?.(error, {
        attempt: attempts,
        retry: retry + 1,
        delayMs,
      });
      await sleep(delayMs);
    }
  }
}
