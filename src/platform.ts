import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const squirrelExecutable =
  '/Library/Input Methods/Squirrel.app/Contents/MacOS/Squirrel';
export const windowsTaskName = 'RimeBilingualIME';

interface RimeDirectoryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function resolveRimeDirectory(
  options: RimeDirectoryOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  if (env.RIME_USER_DIR) return env.RIME_USER_DIR;
  if (platform === 'darwin') return join(home, 'Library', 'Rime');
  if (platform === 'win32') {
    return win32.join(
      env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'),
      'Rime',
    );
  }
  return join(home, '.local', 'share', 'fcitx5', 'rime');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function windowsRoots(env: NodeJS.ProcessEnv): string[] {
  return [
    env.RIME_DEPLOYER_PATH,
    env.ProgramFiles ? join(env.ProgramFiles, 'Rime') : undefined,
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Rime') : undefined,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Rime') : undefined,
  ].filter((value): value is string => Boolean(value));
}

export async function findWeaselDeployer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const root of windowsRoots(env)) {
    if (root.toLowerCase().endsWith('.exe') && (await exists(root))) return root;
    const direct = join(root, 'WeaselDeployer.exe');
    if (await exists(direct)) return direct;
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const directories = entries
        .filter(entry => entry.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name));
      for (const entry of directories) {
        const candidate = join(root, entry.name, 'WeaselDeployer.exe');
        if (await exists(candidate)) return candidate;
      }
    } catch {
      // Try the next conventional installation root.
    }
  }
  return undefined;
}

export async function reloadRime(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (platform === 'darwin') {
    await execFileAsync(squirrelExecutable, ['--reload']);
    return 'Squirrel';
  }
  if (platform === 'win32') {
    const deployer = await findWeaselDeployer(env);
    if (!deployer) {
      throw new Error(
        'WeaselDeployer.exe was not found; set RIME_DEPLOYER_PATH to its full path',
      );
    }
    await execFileAsync(deployer, ['/deploy']);
    return 'Weasel';
  }
  throw new Error(`automatic Rime deployment is not supported on ${platform}`);
}

export async function restartBackgroundWorker(
  uid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  try {
    if (platform === 'darwin') {
      await execFileAsync('launchctl', [
        'kickstart',
        '-k',
        `gui/${uid}/com.local.rime-bilingual`,
      ]);
      return true;
    }
    if (platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Stop-ScheduledTask -TaskName '${windowsTaskName}' -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName '${windowsTaskName}'`,
      ]);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
