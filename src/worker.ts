import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getConfig } from './config.js';
import { waitForStableSnapshot } from './debounce.js';
import {
  appendDiagnosticEvent,
  type DiagnosticEvent,
} from './diagnostics.js';
import { DeferredRequests } from './deferred-requests.js';
import { appendRotatingLine, WorkerLogger } from './logger.js';
import { requestCandidateRefresh } from './platform.js';
import {
  isCacheRefreshContinuation,
  runPreemptible,
} from './preemption.js';
import { RetryLimitError, withRetry } from './retry.js';
import {
  bumpVersion,
  commitQueueOffset,
  compactConsumedQueue,
  loadTranslationMap,
  parseTranslationTsv,
  readQueueWindow,
  writeTranslationMap,
} from './store.js';
import { translateBatch } from './translator.js';

const sleep = (milliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const initialConfig = getConfig();
const logger = new WorkerLogger({
  infoPath: initialConfig.workerLogPath,
  errorPath: initialConfig.workerErrorLogPath,
  maxBytes: initialConfig.logMaxBytes,
  mirrorConsole: process.env.RIME_BILINGUAL_LAUNCH_AGENT !== '1',
});

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function diagnostic(
  config: ReturnType<typeof getConfig>,
  event: Omit<DiagnosticEvent, 'timestamp'>,
): Promise<void> {
  try {
    await appendDiagnosticEvent(
      config.diagnosticPath,
      config.logMaxBytes,
      event,
    );
  } catch (error) {
    await logger.error(
      '[rime-bilingual] diagnostics write failed:',
      describeError(error),
    );
  }
}

async function maintainQueue(config: ReturnType<typeof getConfig>): Promise<void> {
  try {
    const compacted = await compactConsumedQueue(
      config.queuePath,
      config.cursorPath,
      config.queueLockPath,
      config.queueMaxBytes,
    );
    if (compacted) await logger.info('[rime-bilingual] compacted consumed request queue');
  } catch (error) {
    await logger.error(
      '[rime-bilingual] queue maintenance failed:',
      describeError(error),
    );
  }
}

async function main(): Promise<void> {
  let config = getConfig();
  await mkdir(config.dataDirectory, { recursive: true });
  let known = await loadTranslationMap(
    config.seedPath,
    config.dynamicPath,
    config.dictionaryPath,
  );
  let dynamic = parseTranslationTsv(
    await import('node:fs/promises').then(async ({ readFile }) => {
      try {
        return await readFile(config.dynamicPath, 'utf8');
      } catch {
        return '';
      }
    }),
  );
  let warnedMissingKey = false;
  const deferred = new DeferredRequests();
  type RefreshRequest = {
    config: ReturnType<typeof getConfig>;
    batchId: string;
    texts: string[];
    detectedAt: number;
  };
  let pendingRefresh: RefreshRequest | undefined;
  let refreshInFlight: Promise<void> | undefined;

  const drainCandidateRefreshes = async (): Promise<void> => {
    while (pendingRefresh) {
      const request = pendingRefresh;
      pendingRefresh = undefined;
      const refreshRequested = await requestCandidateRefresh();
      await diagnostic(request.config, {
        type: refreshRequested
          ? 'candidate_refresh_requested'
          : 'candidate_refresh_failed',
        batchId: request.batchId,
        texts: request.texts,
        durationMs: Date.now() - request.detectedAt,
      });
    }
    refreshInFlight = undefined;
  };

  const scheduleCandidateRefresh = (request: RefreshRequest): void => {
    // Coalesce refreshes while Squirrel is already responding. The newest cache
    // version contains every prior write, so one final recomposition is enough.
    pendingRefresh = request;
    refreshInFlight ??= drainCandidateRefreshes();
  };

  const cacheTranslations = async (
    translations: ReadonlyMap<string, string>,
    request: RefreshRequest,
  ): Promise<boolean> => {
    const changedTexts: string[] = [];
    for (const [source, english] of translations) {
      known.set(source, english);
      if (dynamic.get(source) === english) continue;
      dynamic.set(source, english);
      changedTexts.push(source);
    }
    if (changedTexts.length === 0) return false;

    await writeTranslationMap(request.config.dynamicPath, dynamic);
    await bumpVersion(request.config.versionPath);
    await diagnostic(request.config, {
      type: 'cache_written',
      batchId: request.batchId,
      texts: changedTexts,
      durationMs: Date.now() - request.detectedAt,
    });
    scheduleCandidateRefresh({ ...request, texts: changedTexts });
    return true;
  };

  await logger.info(
    `[rime-bilingual] worker ready; ${known.size} cached translations; model=${config.model}`,
  );
  await diagnostic(config, { type: 'worker_ready', model: config.model });

  while (true) {
    config = getConfig();
    let window = await readQueueWindow(
      config.queuePath,
      config.cursorPath,
      known,
      config.batchSize,
    );
    let isDeferredBatch = false;

    if (window.texts.length === 0) {
      if (window.nextOffset > window.currentOffset) {
        await commitQueueOffset(config.cursorPath, window.nextOffset);
        await maintainQueue(config);
      }
      const deferredTexts = deferred.take(config.batchSize, known);
      if (deferredTexts.length === 0) {
        await sleep(config.pollMs);
        continue;
      }
      window = { ...window, texts: deferredTexts };
      isDeferredBatch = true;
    }

    let batchId = randomUUID();
    let detectedAt = Date.now();
    await diagnostic(config, {
      type: 'batch_detected',
      batchId,
      texts: window.texts,
      debounceMs: config.debounceMs,
    });

    if (config.apiKey && !isDeferredBatch) {
      const initialWindow = window;
      const stable = await waitForStableSnapshot({
        initial: window,
        readLatest: () =>
          readQueueWindow(
            config.queuePath,
            config.cursorPath,
            known,
            config.batchSize,
          ),
        revision: value => value.nextOffset,
        debounceMs: config.debounceMs,
        pollMs: config.pollMs,
      });
      window = stable.value;
      if (stable.changes > 0) {
        await diagnostic(config, {
          type: 'batch_superseded',
          batchId,
          texts: initialWindow.texts,
          durationMs: Date.now() - detectedAt,
        });
        if (window.texts.length === 0) continue;
        batchId = randomUUID();
        detectedAt = stable.stableSince;
        await diagnostic(config, {
          type: 'batch_detected',
          batchId,
          texts: window.texts,
          debounceMs: config.debounceMs,
        });
      }
    }

    if (!config.apiKey) {
      if (!warnedMissingKey) {
        await logger.error(
          `[rime-bilingual] waiting for a translation API key in ${config.projectRoot}/.env`,
        );
        await diagnostic(config, {
          type: 'api_key_missing',
          batchId,
          texts: window.texts,
        });
        warnedMissingKey = true;
      }
      await sleep(5_000);
      continue;
    }

    warnedMissingKey = false;
    const requestTexts = window.texts;
    const requestOffset = window.nextOffset;
    const requestStartedAt = Date.now();
    const refreshRequest: RefreshRequest = {
      config,
      batchId,
      texts: requestTexts,
      detectedAt,
    };
    const progressivelyCached = new Set<string>();
    await diagnostic(config, {
      type: 'request_started',
      batchId,
      texts: requestTexts,
      model: config.model,
      durationMs: requestStartedAt - detectedAt,
    });
    try {
      const outcome = await runPreemptible(
        signal => withRetry(
          async () => {
            const result = await translateBatch(
              requestTexts,
              config,
              signal,
              async (source, english) => {
                if (
                  source !== requestTexts[0] ||
                  progressivelyCached.has(source)
                ) {
                  return;
                }
                progressivelyCached.add(source);
                await cacheTranslations(
                  new Map([[source, english]]),
                  refreshRequest,
                );
              },
            );
            if (result.size !== requestTexts.length) {
              const missing = requestTexts.filter(text => !result.has(text));
              throw new Error(
                `model omitted translations: ${missing.join(', ')}`,
              );
            }
            return result;
          },
          {
            maxRetries: config.maxRetries,
            baseDelayMs: config.retryBaseMs,
            shouldRetry: () => !signal.aborted,
            onRetry: async (error, retry) => {
              await diagnostic(config, {
                type: 'request_retry',
                batchId,
                texts: requestTexts,
                attempt: retry.attempt,
                maxRetries: config.maxRetries,
                delayMs: retry.delayMs,
                durationMs: Date.now() - requestStartedAt,
                error: describeError(error),
              });
              await logger.error(
                `[rime-bilingual] translation attempt ${retry.attempt} failed; retry ${retry.retry}/${config.maxRetries} in ${retry.delayMs} ms:`,
                describeError(error),
              );
            },
          },
        ),
        {
          pollMs: config.pollMs,
          isSuperseded: async () => {
            const latest = await readQueueWindow(
              config.queuePath,
              config.cursorPath,
              known,
              config.batchSize,
            );
            return isDeferredBatch
              ? latest.texts.length > 0
              : latest.nextOffset !== requestOffset &&
                  !isCacheRefreshContinuation(
                    latest.texts,
                    requestTexts,
                    known,
                  );
          },
        },
      );
      if (outcome.status === 'superseded') {
        if (!isDeferredBatch) deferred.rememberTop(requestTexts);
        await diagnostic(config, {
          type: 'request_superseded',
          batchId,
          texts: requestTexts,
          durationMs: Date.now() - requestStartedAt,
        });
        await logger.info(
          `[rime-bilingual] cancelled stale batch: ${requestTexts.join(' / ')}`,
        );
        continue;
      }
      const translated = outcome.value;
      await diagnostic(config, {
        type: 'request_succeeded',
        batchId,
        texts: requestTexts,
        durationMs: Date.now() - requestStartedAt,
      });
      if (isDeferredBatch) deferred.complete(requestTexts);
      await cacheTranslations(translated, refreshRequest);
      if (!isDeferredBatch) {
        await commitQueueOffset(config.cursorPath, requestOffset);
        await maintainQueue(config);
      }
      await logger.info(`[rime-bilingual] cached: ${requestTexts.join(' / ')}`);
    } catch (error) {
      const attempts = error instanceof RetryLimitError ? error.attempts : 1;
      const cause = error instanceof RetryLimitError ? error.cause : error;
      await appendRotatingLine(
        config.failurePath,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          attempts,
          texts: requestTexts,
          error: describeError(cause),
        }),
        config.logMaxBytes,
      );
      if (isDeferredBatch) {
        deferred.complete(requestTexts);
      } else {
        await commitQueueOffset(config.cursorPath, requestOffset);
        await maintainQueue(config);
      }
      await diagnostic(config, {
        type: 'request_failed',
        batchId,
        texts: requestTexts,
        attempt: attempts,
        durationMs: Date.now() - detectedAt,
        error: describeError(cause),
      });
      await logger.error(
        `[rime-bilingual] dropped batch after ${attempts} attempts: ${requestTexts.join(' / ')}:`,
        describeError(cause),
      );
    }
  }
}

void main().catch(async error => {
  await logger.error('[rime-bilingual] fatal worker error:', describeError(error));
  process.exitCode = 1;
});
