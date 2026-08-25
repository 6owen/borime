import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendRotatingLine } from './logger.js';

describe('appendRotatingLine', () => {
  it('rotates a bounded log and keeps the newest line active', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rime-bilingual-log-'));
    const path = join(directory, 'worker.log');

    await appendRotatingLine(path, '12345', 10, 1);
    await appendRotatingLine(path, '67890', 10, 1);

    expect(await readFile(path, 'utf8')).toBe('67890\n');
    expect(await readFile(`${path}.1`, 'utf8')).toBe('12345\n');
  });
});
