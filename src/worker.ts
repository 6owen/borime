import { mkdir } from 'node:fs/promises';
import { getConfig } from './config.js';
import { appendRotatingLine, WorkerLogger } from './logger.js';
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

    if (config.apiKey) {
      await sleep(config.debounceMs);
      const refreshed = await readQueueWindow(
        config.queuePath,
        config.cursorPath,
        known,
        config.batchSize,
      );
      if (refreshed.nextOffset !== window.nextOffset) continue;
      window = refreshed;
    }

    if (!config.apiKey) {
      if (!warnedMissingKey) {
        await logger.error(
          `[rime-bilingual] waiting for a translation API key in ${config.projectRoot}/.env`,
        );
        warnedMissingKey = true;
      }
      await sleep(5_000);
      continue;
    }

    warnedMissingKey = false;
    try {
      const translated = await withRetry(
        async () => {
          const result = await translateBatch(window.texts, config);
          if (result.size !== window.texts.length) {
            const missing = window.texts.filter(text => !result.has(text));
            throw new Error(`model omitted translations: ${missing.join(', ')}`);
          }
          return result;
        },
        {
          maxRetries: config.maxRetries,
          baseDelayMs: config.retryBaseMs,
          onRetry: async (error, retry) => {
            await logger.error(
              `[rime-bilingual] translation attempt ${retry.attempt} failed; retry ${retry.retry}/${config.maxRetries} in ${retry.delayMs} ms:`,
              describeError(error),
            );
          },
        },
      );
      for (const [source, english] of translated) {
        dynamic.set(source, english);
        known.set(source, english);
      }
      await writeTranslationMap(config.dynamicPath, dynamic);
      await bumpVersion(config.versionPath);
      await commitQueueOffset(config.cursorPath, window.nextOffset);
      await maintainQueue(config);
      await logger.info(`[rime-bilingual] cached: ${window.texts.join(' / ')}`);
    } catch (error) {
      const attempts = error instanceof RetryLimitError ? error.attempts : 1;
      const cause = error instanceof RetryLimitError ? error.cause : error;
      await appendRotatingLine(
        config.failurePath,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          attempts,
          texts: window.texts,
          error: describeError(cause),
        }),
        config.logMaxBytes,
      );
      await commitQueueOffset(config.cursorPath, window.nextOffset);
      await maintainQueue(config);
      await logger.error(
        `[rime-bilingual] dropped batch after ${attempts} attempts: ${window.texts.join(' / ')}:`,
        describeError(cause),
      );
    }
  }
}

void main().catch(async error => {
  await logger.error('[rime-bilingual] fatal worker error:', describeError(error));
  process.exitCode = 1;
});
