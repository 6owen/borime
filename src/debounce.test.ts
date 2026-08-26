import { describe, expect, it } from 'vitest';
import { waitForStableSnapshot } from './debounce.js';

describe('waitForStableSnapshot', () => {
  it('returns after one quiet window', async () => {
    let time = 0;
    await expect(
      waitForStableSnapshot({
        initial: { revision: 1 },
        readLatest: async () => ({ revision: 1 }),
        revision: value => value.revision,
        debounceMs: 200,
        pollMs: 50,
        now: () => time,
        sleep: async milliseconds => {
          time += milliseconds;
        },
      }),
    ).resolves.toEqual({
      value: { revision: 1 },
      changes: 0,
      stableSince: 0,
    });
    expect(time).toBe(200);
  });

  it('resets the deadline as soon as a newer snapshot is observed', async () => {
    let time = 0;
    const seenAt = 100;
    const result = await waitForStableSnapshot({
      initial: { revision: 1 },
      readLatest: async () => ({ revision: time >= seenAt ? 2 : 1 }),
      revision: value => value.revision,
      debounceMs: 200,
      pollMs: 50,
      now: () => time,
      sleep: async milliseconds => {
        time += milliseconds;
      },
    });

    expect(result).toEqual({
      value: { revision: 2 },
      changes: 1,
      stableSince: seenAt,
    });
    expect(time).toBe(300);
  });
});
