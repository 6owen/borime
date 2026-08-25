import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getConfig } from './config.js';
import { reloadRime, restartBackgroundWorker } from './platform.js';
import {
  atomicWrite,
  bumpVersion,
  serializeTranslationTsv,
} from './store.js';

export const cedictSource =
  'https://raw.githubusercontent.com/qundao/backup-cc-cedict/main/cedict.txt';

function definitionScore(value: string): number {
  const discouraged = /^(?:old )?variant of |^see |^abbr\.? (?:for|of) |^classifier for |^Taiwan pr\./i;
  return (discouraged.test(value) ? 10_000 : 0) + value.length;
}

function cleanDefinition(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^also written .+?\|/i, '')
    .trim()
    .slice(0, 120);
}

export function parseCedict(content: string): Map<string, string> {
  const best = new Map<string, { definition: string; score: number }>();
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(\S+) (\S+) \[[^\]]+\] \/(.+)\/$/);
    if (!match) continue;
    const simplified = match[2];
    if (!/^[\p{Script=Han}·]{1,12}$/u.test(simplified)) continue;

    for (const rawDefinition of match[3].split('/')) {
      const definition = cleanDefinition(rawDefinition);
      if (!definition || definition.startsWith('CL:')) continue;
      const score = definitionScore(definition);
      const previous = best.get(simplified);
      if (!previous || score < previous.score) {
        best.set(simplified, { definition, score });
      }
    }
  }
  return new Map(
    [...best].map(([source, value]) => [source, value.definition]),
  );
}

export async function main(): Promise<void> {
  const config = getConfig();
  console.log(`[rime-bilingual] downloading CC-CEDICT from ${cedictSource}`);
  const response = await fetch(cedictSource, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`CC-CEDICT download failed: HTTP ${response.status}`);
  }
  const entries = parseCedict(await response.text());
  const header = [
    '# Derived from CC-CEDICT, published by MDBG and community contributors.',
    '# Source mirror: https://github.com/qundao/backup-cc-cedict',
    '# License: Creative Commons Attribution-ShareAlike 4.0 International.',
    '# https://creativecommons.org/licenses/by-sa/4.0/',
    '',
  ].join('\n');
  await atomicWrite(
    config.dictionaryPath,
    `${header}${serializeTranslationTsv(entries)}`,
  );
  await bumpVersion(config.versionPath);

  await restartBackgroundWorker(config.uid);
  try {
    const frontend = await reloadRime();
    console.log(`[rime-bilingual] reloaded ${frontend} so the new dictionary is active`);
  } catch (error) {
    console.warn(
      '[rime-bilingual] dictionary imported, but Rime could not be reloaded automatically:',
      error,
    );
  }
  console.log(`[rime-bilingual] imported ${entries.size} CC-CEDICT translations`);
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMain) {
  void main().catch(error => {
    console.error('[rime-bilingual] CC-CEDICT import failed:', error);
    process.exitCode = 1;
  });
}
