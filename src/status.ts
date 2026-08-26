import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from './config.js';
import { findWeaselDeployer, squirrelExecutable } from './platform.js';
import {
  loadTranslationMap,
  parseTranslationTsv,
  readQueueStats,
  readText,
} from './store.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function size(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function lineCount(content: string): number {
  return content.split(/\r?\n/).filter(Boolean).length;
}

async function main(): Promise<void> {
  const config = getConfig();
  const translations = await loadTranslationMap(
    config.seedPath,
    config.dynamicPath,
    config.dictionaryPath,
  );
  const [dictionary, seed, dynamic, queue, failures] = await Promise.all([
    readText(config.dictionaryPath).then(parseTranslationTsv),
    readText(config.seedPath).then(parseTranslationTsv),
    readText(config.dynamicPath).then(parseTranslationTsv),
    readQueueStats(config.queuePath, config.cursorPath),
    readText(config.failurePath),
  ]);
  console.log(`Rime directory: ${config.rimeDirectory}`);
  const frontend = process.platform === 'darwin'
    ? `Squirrel (${await exists(squirrelExecutable) ? 'installed' : 'missing'})`
    : process.platform === 'win32'
      ? `Weasel (${(await findWeaselDeployer()) ? 'installed' : 'missing'})`
      : `Rime frontend (${process.platform})`;
  console.log(`Rime frontend: ${frontend}`);
  console.log(`Flypy schema installed: ${await exists(join(config.rimeDirectory, 'double_pinyin_flypy.schema.yaml'))}`);
  console.log(`Bilingual patch installed: ${await exists(join(config.rimeDirectory, 'lua', 'bilingual_filter.lua'))}`);
  console.log(`Translation API key configured: ${Boolean(config.apiKey)}`);
  console.log(`AI candidate requests enabled: ${await exists(config.aiEnabledPath)}`);
  console.log(`API mode: ${config.baseURL ? 'OpenAI-compatible' : 'DeepSeek official'}`);
  console.log(`Translation model: ${config.model}`);
  console.log(`Effective cached translations: ${translations.size}`);
  console.log(`  CC-CEDICT: ${dictionary.size}`);
  console.log(`  Preset: ${seed.size}`);
  console.log(`  AI/overrides: ${dynamic.size}`);
  console.log(`Pending request lines: ${queue.pendingLines}`);
  console.log(`Request history lines: ${queue.historyLines}`);
  console.log(`Request queue bytes: ${queue.queueBytes}`);
  console.log(`Failed batches retained: ${lineCount(failures)}`);
  console.log(`Worker log bytes: ${await size(config.workerLogPath)}`);
  console.log(`Worker error log bytes: ${await size(config.workerErrorLogPath)}`);
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
