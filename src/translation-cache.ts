import { chmod, cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import { reloadRime, restartBackgroundWorker } from './platform.js';
import {
  bumpVersion,
  parseTranslationTsv,
  writeTranslationMap,
} from './store.js';

export function mergeTranslationCaches(
  current: ReadonlyMap<string, string>,
  incoming: ReadonlyMap<string, string>,
): Map<string, string> {
  return new Map([...current, ...incoming]);
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function exportCache(output: string): Promise<void> {
  const config = getConfig();
  const outputPath = resolve(output);
  await mkdir(dirname(outputPath), { recursive: true });
  await cp(config.dynamicPath, outputPath, { force: true });
  if (process.platform !== 'win32') await chmod(outputPath, 0o600);
  console.log(`[rime-bilingual] exported private AI cache to ${outputPath}`);
}

async function importCache(input: string): Promise<void> {
  const config = getConfig();
  const [currentContent, incomingContent] = await Promise.all([
    readFile(config.dynamicPath, 'utf8').catch(() => ''),
    readFile(resolve(input), 'utf8'),
  ]);
  const current = parseTranslationTsv(currentContent);
  const incoming = parseTranslationTsv(incomingContent);
  const merged = mergeTranslationCaches(current, incoming);
  await writeTranslationMap(config.dynamicPath, merged);
  await bumpVersion(config.versionPath);
  await restartBackgroundWorker(config.uid);
  await reloadRime().catch(() => undefined);
  console.log(
    `[rime-bilingual] merged ${incoming.size} entries; AI cache now has ${merged.size}`,
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'export') {
    const output = argument('--output');
    if (!output) throw new Error('usage: cache:export -- --output <private-file.tsv>');
    await exportCache(output);
    return;
  }
  if (mode === 'import') {
    const input = argument('--input');
    if (!input) throw new Error('usage: cache:import -- --input <private-file.tsv>');
    await importCache(input);
    return;
  }
  throw new Error('expected export or import mode');
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMain) {
  void main().catch(error => {
    console.error('[rime-bilingual] translation cache operation failed:', error);
    process.exitCode = 1;
  });
}
