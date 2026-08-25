import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWeaselDeployer, resolveRimeDirectory } from './platform.js';

describe('resolveRimeDirectory', () => {
  it('uses the native macOS user directory', () => {
    expect(
      resolveRimeDirectory({ platform: 'darwin', env: {}, home: '/Users/test' }),
    ).toBe('/Users/test/Library/Rime');
  });

  it('uses APPDATA on Windows', () => {
    expect(
      resolveRimeDirectory({
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
        home: 'C:\\Users\\test',
      }),
    ).toBe('C:\\Users\\test\\AppData\\Roaming\\Rime');
  });

  it('allows an explicit portable directory', () => {
    expect(
      resolveRimeDirectory({
        platform: 'win32',
        env: { RIME_USER_DIR: 'D:\\Portable\\Rime' },
      }),
    ).toBe('D:\\Portable\\Rime');
  });
});

describe('findWeaselDeployer', () => {
  it('finds a versioned Weasel installation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rime-weasel-'));
    const install = join(directory, 'Rime', 'weasel-0.17.4');
    await mkdir(install, { recursive: true });
    await writeFile(join(install, 'WeaselDeployer.exe'), 'test');

    await expect(
      findWeaselDeployer({ ProgramFiles: directory }),
    ).resolves.toBe(join(install, 'WeaselDeployer.exe'));
  });
});
