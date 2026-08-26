import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getConfig } from './config.js';
import {
  appendDiagnosticEvent,
  type DiagnosticEvent,
} from './diagnostics.js';
import { appendRotatingLine, WorkerLogger } from './logger.js';
import { runPreemptible } from './preemption.js';
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

    if (window.texts.length === 0) {
      if (window.nextOffset > window.currentOffset) {
        await commitQueueOffset(config.cursorPath, window.nextOffset);
        await maintainQueue(config);
      }
      await sleep(config.pollMs);
      continue;
    }

    const batchId = randomUUID();
    const detectedAt = Date.now();
    await diagnostic(config, {
      type: 'batch_detected',
      batchId,
      texts: window.texts,
      debounceMs: config.debounceMs,
    });

    if (config.apiKey) {
      await sleep(config.debounceMs);
      const refreshed = await readQueueWindow(
        config.queuePath,
        config.cursorPath,
        known,
        config.batchSize,
      );
      if (refreshed.nextOffset !== window.nextOffset) {
        await diagnostic(config, {
          type: 'batch_superseded',
          batchId,
          texts: window.texts,
          durationMs: Date.now() - detectedAt,
        });
        continue;
      }
      window = refreshed;
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
            const result = await translateBatch(requestTexts, config, signal);
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
            return latest.nextOffset !== requestOffset;
          },
        },
      );
      if (outcome.status === 'superseded') {
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
      for (const [source, english] of translated) {
        dynamic.set(source, english);
        known.set(source, english);
      }
      await writeTranslationMap(config.dynamicPath, dynamic);
      await bumpVersion(config.versionPath);
      await commitQueueOffset(config.cursorPath, requestOffset);
      await maintainQueue(config);
      await diagnostic(config, {
        type: 'cache_written',
        batchId,
        texts: requestTexts,
        durationMs: Date.now() - detectedAt,
      });
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
      await commitQueueOffset(config.cursorPath, requestOffset);
      await maintainQueue(config);
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
