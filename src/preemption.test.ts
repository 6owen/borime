import { describe, expect, it } from 'vitest';
import {
  isCacheRefreshContinuation,
  runPreemptible,
} from './preemption.js';

describe('isCacheRefreshContinuation', () => {
  it('recognizes the same composition after its top translation was cached', () => {
    expect(
      isCacheRefreshContinuation(
        ['第二候选', '第三候选'],
        ['第一候选', '第二候选', '第三候选'],
        new Map([['第一候选', 'first candidate']]),
      ),
    ).toBe(true);
  });

  it('does not mistake newer user input for a cache-driven refresh', () => {
    expect(
      isCacheRefreshContinuation(
        ['新的输入'],
        ['第一候选', '第二候选'],
        new Map([['第一候选', 'first candidate']]),
      ),
    ).toBe(false);
  });
});

describe('runPreemptible', () => {
  it('aborts an in-flight operation when newer input arrives', async () => {
    let checks = 0;
    let aborted = false;
    const result = await runPreemptible(
      signal =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      {
        pollMs: 1,
        isSuperseded: async () => {
          checks += 1;
          return checks >= 2;
        },
      },
    );

    expect(result).toEqual({ status: 'superseded' });
    expect(aborted).toBe(true);
  });

  it('returns a completed value when the input stays current', async () => {
    await expect(
      runPreemptible(async () => 'translated', {
        pollMs: 1,
        isSuperseded: async () => false,
      }),
    ).resolves.toEqual({ status: 'completed', value: 'translated' });
  });

  it('discards a result that became stale as it completed', async () => {
    await expect(
      runPreemptible(async () => 'stale translation', {
        pollMs: 1,
        isSuperseded: async () => true,
      }),
    ).resolves.toEqual({ status: 'superseded' });
  });
});
