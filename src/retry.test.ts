import { describe, expect, it, vi } from 'vitest';
import { RetryLimitError, withRetry } from './retry.js';

describe('withRetry', () => {
  it('uses exponential backoff and returns after a transient failure', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('ok');
    const sleep = vi.fn(async () => undefined);

    await expect(
      withRetry(operation, { maxRetries: 3, baseDelayMs: 2_000, sleep }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('stops after the configured number of retries', async () => {
    const operation = vi.fn(async () => {
      throw new Error('still broken');
    });
    const sleep = vi.fn(async () => undefined);

    const result = withRetry(operation, {
      maxRetries: 3,
      baseDelayMs: 2_000,
      sleep,
    });
    await expect(result).rejects.toMatchObject<Partial<RetryLimitError>>({
      name: 'RetryLimitError',
      attempts: 4,
    });
    expect(operation).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      2_000,
      4_000,
      8_000,
    ]);
  });
});
