import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findWeaselDeployer,
  requestCandidateRefresh,
  resolveRimeDirectory,
  squirrelExecutable,
} from './platform.js';

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

describe('requestCandidateRefresh', () => {
  it('asks the active Squirrel controller to recompose without typing a key', async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];

    await expect(
      requestCandidateRefresh('darwin', async (executable, args) => {
        calls.push({ executable, args });
        return { stdout: args[0] === '--getascii' ? 'nascii\n' : '' };
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      { executable: squirrelExecutable, args: ['--getascii'] },
      { executable: squirrelExecutable, args: ['--nascii'] },
    ]);
  });

  it('does not switch the user out of ASCII mode after a delayed response', async () => {
    const calls: string[][] = [];
    await expect(
      requestCandidateRefresh('darwin', async (_executable, args) => {
        calls.push(args);
        return { stdout: 'ascii\n' };
      }),
    ).resolves.toBe(false);
    expect(calls).toEqual([['--getascii']]);
  });

  it('is a no-op on unsupported frontends', async () => {
    let called = false;
    await expect(
      requestCandidateRefresh('win32', async () => {
        called = true;
      }),
    ).resolves.toBe(false);
    expect(called).toBe(false);
  });
});
