import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';

export interface QueueWindow {
  texts: string[];
  currentOffset: number;
  nextOffset: number;
}

export interface QueueStats {
  historyLines: number;
  pendingLines: number;
  queueBytes: number;
  consumedBytes: number;
}

export function cleanCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseTranslationTsv(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const source = cleanCell(line.slice(0, tab));
    const english = cleanCell(line.slice(tab + 1));
    if (source && english) result.set(source, english);
  }
  return result;
}

export function serializeTranslationTsv(entries: Map<string, string>): string {
  const rows = [...entries]
    .map(([source, english]) => [cleanCell(source), cleanCell(english)] as const)
    .filter(([source, english]) => source && english)
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans'))
    .map(([source, english]) => `${source}\t${english}`);
  return rows.length ? `${rows.join('\n')}\n` : '';
}

export async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function loadTranslationMap(
  seedPath: string,
  dynamicPath: string,
  dictionaryPath?: string,
): Promise<Map<string, string>> {
  const dictionary = dictionaryPath
    ? parseTranslationTsv(await readText(dictionaryPath))
    : new Map<string, string>();
  const seed = parseTranslationTsv(await readText(seedPath));
  const dynamic = parseTranslationTsv(await readText(dynamicPath));
  return new Map([...dictionary, ...seed, ...dynamic]);
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export async function writeTranslationMap(
  path: string,
  entries: Map<string, string>,
): Promise<void> {
  await atomicWrite(path, serializeTranslationTsv(entries));
}

export async function bumpVersion(path: string): Promise<void> {
  await atomicWrite(path, `${Date.now()}\n`);
}

export async function readOffset(path: string): Promise<number> {
  const parsed = Number.parseInt((await readText(path)).trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function countCompleteLines(buffer: Buffer): number {
  let count = 0;
  for (const byte of buffer) {
    if (byte === 0x0a) count += 1;
  }
  return count;
}

export async function readQueueStats(
  queuePath: string,
  cursorPath: string,
): Promise<QueueStats> {
  let queue: Buffer;
  try {
    queue = await readFile(queuePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { historyLines: 0, pendingLines: 0, queueBytes: 0, consumedBytes: 0 };
    }
    throw error;
  }
  let offset = await readOffset(cursorPath);
  if (offset > queue.length) offset = 0;
  return {
    historyLines: countCompleteLines(queue),
    pendingLines: countCompleteLines(queue.subarray(offset)),
    queueBytes: queue.length,
    consumedBytes: offset,
  };
}

const sleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export async function compactConsumedQueue(
  queuePath: string,
  cursorPath: string,
  lockPath: string,
  maxBytes: number,
): Promise<boolean> {
  let queueSize: number;
  try {
    queueSize = (await stat(queuePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (queueSize < maxBytes || (await readOffset(cursorPath)) !== queueSize) {
    return false;
  }

  await writeFile(lockPath, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    // Lua opens and closes the queue synchronously. This grace period lets a writer
    // that passed the lock check finish before the final size verification.
    await sleep(50);
    const refreshedSize = (await stat(queuePath)).size;
    if (
      refreshedSize !== queueSize ||
      (await readOffset(cursorPath)) !== refreshedSize
    ) {
      return false;
    }
    await truncate(queuePath, 0);
    await commitQueueOffset(cursorPath, 0);
    return true;
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function commitQueueOffset(path: string, offset: number): Promise<void> {
  await atomicWrite(path, `${offset}\n`);
}

export async function readQueueWindow(
  queuePath: string,
  cursorPath: string,
  known: ReadonlyMap<string, string>,
  limit: number,
): Promise<QueueWindow> {
  let queueSize = 0;
  try {
    queueSize = (await stat(queuePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { texts: [], currentOffset: 0, nextOffset: 0 };
    }
    throw error;
  }

  let offset = await readOffset(cursorPath);
  if (offset > queueSize) offset = 0;
  if (offset === queueSize) {
    return { texts: [], currentOffset: offset, nextOffset: offset };
  }

  const handle = await open(queuePath, 'r');
  try {
    const buffer = Buffer.alloc(queueSize - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    const recent = new Map<string, true>();
    let lineStart = 0;
    let nextOffset = offset;

    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 0x0a) continue;
      const text = cleanCell(buffer.subarray(lineStart, index).toString('utf8'));
      nextOffset = offset + index + 1;
      lineStart = index + 1;
      if (!text || known.has(text)) continue;
      // Reinsert duplicates so the map preserves the most recent request order.
      recent.delete(text);
      recent.set(text, true);
    }

    const texts = [...recent.keys()].slice(-limit);
    return { texts, currentOffset: offset, nextOffset };
  } finally {
    await handle.close();
  }
}
