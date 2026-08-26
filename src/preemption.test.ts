import { describe, expect, it } from 'vitest';
import { runPreemptible } from './preemption.js';

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
