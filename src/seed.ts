import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import {
  bumpVersion,
  loadTranslationMap,
  parseTranslationTsv,
  writeTranslationMap,
} from './store.js';
import { translateBatch } from './translator.js';

interface DictionaryEntry {
  text: string;
  weight: number;
}

function numericArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const parsed = Number.parseInt(process.argv[index + 1] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function extractCommonEntries(content: string): DictionaryEntry[] {
  const body = content.split(/^\.\.\.\s*$/m)[1] ?? '';
  const best = new Map<string, number>();
  for (const line of body.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [text, , weightText] = line.split('\t');
    if (!text || !/^[\p{Script=Han}]{2,10}$/u.test(text)) continue;
    const weight = Number.parseInt(weightText ?? '1', 10);
    best.set(text, Math.max(best.get(text) ?? 0, Number.isFinite(weight) ? weight : 1));
  }
  return [...best]
    .map(([text, weight]) => ({ text, weight }))
    .sort((left, right) => right.weight - left.weight || left.text.localeCompare(right.text));
}

async function main(): Promise<void> {
  const count = numericArgument('--count', 2_000);
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error(`Add a translation API key to ${config.projectRoot}/.env first`);
  }

  const dictionaryPath = join(
    config.projectRoot,
    'vendor',
    'rime-ice',
    'cn_dicts',
    'base.dict.yaml',
  );
  const dictionary = extractCommonEntries(await readFile(dictionaryPath, 'utf8'));
  const allKnown = await loadTranslationMap(
    config.seedPath,
    config.dynamicPath,
    config.dictionaryPath,
  );
  let seed: Map<string, string>;
  try {
    seed = parseTranslationTsv(await readFile(config.seedPath, 'utf8'));
  } catch {
    seed = new Map();
  }

  const pending = dictionary
    .map(entry => entry.text)
    .filter(text => !allKnown.has(text))
    .slice(0, count);
  console.log(`[rime-bilingual] generating ${pending.length} seed translations`);

  for (let index = 0; index < pending.length; index += config.batchSize) {
    const batch = pending.slice(index, index + config.batchSize);
    const translated = await translateBatch(batch, config);
    if (translated.size !== batch.length) {
      const missing = batch.filter(text => !translated.has(text));
      throw new Error(`model omitted translations: ${missing.join(', ')}`);
    }
    for (const [source, english] of translated) {
      seed.set(source, english);
      allKnown.set(source, english);
    }
    await writeTranslationMap(config.seedPath, seed);
    await bumpVersion(config.versionPath);
    console.log(`[rime-bilingual] ${Math.min(index + batch.length, pending.length)}/${pending.length}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch(error => {
    console.error('[rime-bilingual] seed generation failed:', error);
    process.exitCode = 1;
  });
}
