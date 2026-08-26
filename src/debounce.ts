export interface StableSnapshotOptions<T> {
  initial: T;
  readLatest: () => Promise<T>;
  revision: (value: T) => string | number;
  debounceMs: number;
  pollMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface StableSnapshot<T> {
  value: T;
  changes: number;
  stableSince: number;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

/**
 * Wait until the latest snapshot has remained unchanged for debounceMs.
 *
 * Unlike a single long sleep followed by a stale check, this observes changes
 * throughout the quiet period. A newer snapshot resets the same sliding
 * deadline instead of making the caller finish an obsolete delay and start a
 * second full delay.
 */
export async function waitForStableSnapshot<T>(
  options: StableSnapshotOptions<T>,
): Promise<StableSnapshot<T>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const debounceMs = Math.max(0, options.debounceMs);
  const pollMs = Math.max(1, options.pollMs);
  let value = options.initial;
  let currentRevision = options.revision(value);
  let stableSince = now();
  let changes = 0;

  while (true) {
    const remaining = debounceMs - (now() - stableSince);
    if (remaining <= 0) return { value, changes, stableSince };

    await sleep(Math.min(pollMs, remaining));
    const latest = await options.readLatest();
    const latestRevision = options.revision(latest);
    if (latestRevision !== currentRevision) {
      value = latest;
      currentRevision = latestRevision;
      stableSince = now();
      changes += 1;
    }
  }
}
