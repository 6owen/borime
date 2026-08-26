export type PreemptibleResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'superseded' };

export interface PreemptionOptions {
  pollMs: number;
  isSuperseded: () => boolean | Promise<boolean>;
}

export function isCacheRefreshContinuation(
  latestTexts: readonly string[],
  requestTexts: readonly string[],
  known: ReadonlyMap<string, string>,
): boolean {
  const stillMissing = requestTexts.filter(text => !known.has(text));
  return (
    latestTexts.length === stillMissing.length &&
    latestTexts.every((text, index) => text === stillMissing[index])
  );
}

type OperationOutcome<T> =
  | { status: 'completed'; value: T }
  | { status: 'failed'; error: unknown };

const sleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export async function runPreemptible<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: PreemptionOptions,
): Promise<PreemptibleResult<T>> {
  const controller = new AbortController();
  const operationOutcome: Promise<OperationOutcome<T>> = operation(
    controller.signal,
  ).then(
    value => ({ status: 'completed', value }),
    error => ({ status: 'failed', error }),
  );

  while (true) {
    const outcome = await Promise.race([
      operationOutcome,
      sleep(Math.max(1, options.pollMs)).then(() => ({
        status: 'poll' as const,
      })),
    ]);

    if (outcome.status === 'failed') throw outcome.error;
    if (outcome.status === 'completed') {
      if (await options.isSuperseded()) return { status: 'superseded' };
      return outcome;
    }
    if (await options.isSuperseded()) {
      controller.abort(new DOMException('newer input arrived', 'AbortError'));
      return { status: 'superseded' };
    }
  }
}
