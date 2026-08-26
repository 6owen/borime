import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findWeaselDeployer,
  inspectSquirrelRuntime,
  parseSquirrelProcesses,
  requestCandidateRefresh,
  resolveRimeDirectory,
  squirrelExecutable,
} from './platform.js';

describe('Squirrel runtime health', () => {
  it('finds duplicate CLI processes and the userdb lock owner', async () => {
    const ps = [
      `79713 ${squirrelExecutable}`,
      `35841 ${squirrelExecutable} --version`,
      '99999 /usr/bin/unrelated',
    ].join('\n');
    const calls: string[] = [];
    const health = await inspectSquirrelRuntime(
      '/Users/test/Library/Rime/rime_ice.userdb/LOCK',
      async executable => {
        calls.push(executable);
        return executable === '/bin/ps'
          ? { stdout: ps }
          : { stdout: '35841\n' };
      },
    );

    expect(health.processes.map(process => process.pid)).toEqual([
      79713,
      35841,
    ]);
    expect(health.suspiciousProcesses).toEqual([
      expect.objectContaining({ pid: 35841, arguments: '--version' }),
    ]);
    expect(health.userDbLockOwners).toEqual([35841]);
    expect(calls).toEqual(['/bin/ps', '/usr/sbin/lsof']);
  });

  it('parses the executable path even though it contains spaces', () => {
    expect(
      parseSquirrelProcesses(` 42 ${squirrelExecutable}\n`),
    ).toEqual([
      {
        pid: 42,
        command: squirrelExecutable,
        arguments: '',
      },
    ]);
  });
});

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
    const calls: Array<{
      executable: string;
      args: string[];
      timeout?: number;
    }> = [];

    await expect(
      requestCandidateRefresh('darwin', async (executable, args, options) => {
        calls.push({ executable, args, timeout: options?.timeout });
        return { stdout: args[0] === '--getascii' ? 'nascii\n' : '' };
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      {
        executable: squirrelExecutable,
        args: ['--getascii'],
        timeout: 300,
      },
      {
        executable: squirrelExecutable,
        args: ['--nascii'],
        timeout: 300,
      },
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

  it('bounds a missing Squirrel controller response', async () => {
    const startedAt = Date.now();
    await expect(
      requestCandidateRefresh(
        'darwin',
        async (_executable, _args, options) => {
          await new Promise(resolve =>
            setTimeout(resolve, (options?.timeout ?? 0) + 5),
          );
          throw new Error('timed out');
        },
        10,
      ),
    ).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(100);
  });
});
