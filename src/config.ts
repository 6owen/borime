import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(sourceDirectory, '..');

export function reloadLocalEnv(): void {
  const envPath = join(projectRoot, '.env');
  if (existsSync(envPath)) {
    loadEnvFile(envPath);
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface AppConfig {
  projectRoot: string;
  rimeDirectory: string;
  dataDirectory: string;
  seedPath: string;
  dictionaryPath: string;
  dynamicPath: string;
  queuePath: string;
  cursorPath: string;
  queueLockPath: string;
  versionPath: string;
  failurePath: string;
  workerLogPath: string;
  workerErrorLogPath: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  batchSize: number;
  pollMs: number;
  debounceMs: number;
  timeoutMs: number;
  maxOutputTokens: number;
  maxRetries: number;
  retryBaseMs: number;
  queueMaxBytes: number;
  logMaxBytes: number;
  uid: number;
}

export function getConfig(): AppConfig {
  reloadLocalEnv();
  const rimeDirectory = join(homedir(), 'Library', 'Rime');
  const dataDirectory =
    process.env.RIME_BILINGUAL_DATA_DIR ?? join(rimeDirectory, 'bilingual');
  const baseURL = process.env.OPENAI_BASE_URL;
  const apiKey = baseURL
    ? process.env.OPENAI_API_KEY
    : process.env.DEEPSEEK_API_KEY;

  return {
    projectRoot,
    rimeDirectory,
    dataDirectory,
    seedPath: join(dataDirectory, 'seed.tsv'),
    dictionaryPath: join(dataDirectory, 'cedict.tsv'),
    dynamicPath: join(dataDirectory, 'dynamic.tsv'),
    queuePath: join(dataDirectory, 'requests.txt'),
    cursorPath: join(dataDirectory, '.queue-offset'),
    queueLockPath: join(dataDirectory, '.queue-maintenance'),
    versionPath: join(dataDirectory, 'cache.version'),
    failurePath: join(dataDirectory, 'failed-requests.jsonl'),
    workerLogPath: join(dataDirectory, 'worker.log'),
    workerErrorLogPath: join(dataDirectory, 'worker.error.log'),
    model:
      process.env.MASTRA_CHAT_MODEL ??
      process.env.DEEPSEEK_MODEL ??
      'deepseek-v4-flash',
    apiKey,
    baseURL,
    batchSize: positiveInteger(process.env.RIME_BILINGUAL_BATCH_SIZE, 5),
    pollMs: positiveInteger(process.env.RIME_BILINGUAL_POLL_MS, 250),
    debounceMs: positiveInteger(process.env.RIME_BILINGUAL_DEBOUNCE_MS, 800),
    timeoutMs: positiveInteger(
      process.env.RIME_BILINGUAL_TIMEOUT_MS,
      baseURL ? 30_000 : 15_000,
    ),
    maxOutputTokens: positiveInteger(
      process.env.RIME_BILINGUAL_MAX_OUTPUT_TOKENS,
      baseURL ? 2_048 : 512,
    ),
    maxRetries: nonNegativeInteger(process.env.RIME_BILINGUAL_MAX_RETRIES, 3),
    retryBaseMs: positiveInteger(
      process.env.RIME_BILINGUAL_RETRY_BASE_MS,
      2_000,
    ),
    queueMaxBytes: positiveInteger(
      process.env.RIME_BILINGUAL_QUEUE_MAX_BYTES,
      1_048_576,
    ),
    logMaxBytes: positiveInteger(
      process.env.RIME_BILINGUAL_LOG_MAX_BYTES,
      1_048_576,
    ),
    uid: userInfo().uid,
  };
}
