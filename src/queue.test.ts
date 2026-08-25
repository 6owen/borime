import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commitQueueOffset,
  compactConsumedQueue,
  readQueueStats,
  readQueueWindow,
} from './store.js';

describe('request queue', () => {
  it('advances only through complete lines and skips cached values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rime-bilingual-'));
    const queue = join(directory, 'requests.txt');
    const cursor = join(directory, '.queue-offset');
    await writeFile(queue, '你好\n谢谢\n未完成', 'utf8');

    const first = await readQueueWindow(
      queue,
      cursor,
      new Map([['你好', 'hello']]),
      5,
    );
    expect(first.texts).toEqual(['谢谢']);
    expect(first.nextOffset).toBe(Buffer.byteLength('你好\n谢谢\n'));

    await commitQueueOffset(cursor, first.nextOffset);
    const second = await readQueueWindow(queue, cursor, new Map(), 5);
    expect(second.texts).toEqual([]);
    expect(second.nextOffset).toBe(second.currentOffset);
  });

  it('collapses stale input states to the latest unique candidates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rime-bilingual-'));
    const queue = join(directory, 'requests.txt');
    const cursor = join(directory, '.queue-offset');
    const content = '你\n泥\n你好\n拟好\n你好\n你会\n你还\n';
    await writeFile(queue, content, 'utf8');

    const window = await readQueueWindow(queue, cursor, new Map(), 3);

    expect(window.texts).toEqual(['你好', '你会', '你还']);
    expect(window.nextOffset).toBe(Buffer.byteLength(content));
  });

  it('reports pending lines from the committed byte offset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rime-bilingual-'));
    const queue = join(directory, 'requests.txt');
    const cursor = join(directory, '.queue-offset');
    await writeFile(queue, '历史一\n历史二\n待处理\n', 'utf8');
    await commitQueueOffset(cursor, Buffer.byteLength('历史一\n历史二\n'));

    await expect(readQueueStats(queue, cursor)).resolves.toMatchObject({
      historyLines: 3,
      pendingLines: 1,
    });
  });

  it('compacts a fully consumed queue after it reaches the size limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rime-bilingual-'));
    const queue = join(directory, 'requests.txt');
    const cursor = join(directory, '.queue-offset');
    const lock = join(directory, '.queue-maintenance');
    const content = '一\n二\n三\n';
    await writeFile(queue, content, 'utf8');
    await commitQueueOffset(cursor, Buffer.byteLength(content));

    await expect(
      compactConsumedQueue(queue, cursor, lock, 1),
    ).resolves.toBe(true);
    await expect(readQueueStats(queue, cursor)).resolves.toEqual({
      historyLines: 0,
      pendingLines: 0,
      queueBytes: 0,
      consumedBytes: 0,
    });
  });
});
