import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  cp,
  mkdir,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type AppConfig, getConfig } from './config.js';
import { reloadRime, windowsTaskName } from './platform.js';

const execFileAsync = promisify(execFile);
const sleep = (milliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasFiles(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length > 0;
  } catch {
    return false;
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function secureFile(path: string): Promise<void> {
  if (process.platform !== 'win32') await chmod(path, 0o600).catch(() => undefined);
}

async function installRimeFiles(config: AppConfig): Promise<void> {
  const sourceRime = join(config.projectRoot, 'vendor', 'rime-ice');
  const integration = join(config.projectRoot, 'rime');
  const marker = join(config.rimeDirectory, '.rime-bilingual-installed');
  if (!(await exists(join(sourceRime, 'default.yaml')))) {
    throw new Error(
      'vendor/rime-ice is missing; clone with --recurse-submodules or run git submodule update --init',
    );
  }

  const alreadyInstalled = await exists(marker);
  if (!alreadyInstalled && (await directoryHasFiles(config.rimeDirectory))) {
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const backup = `${config.rimeDirectory}.backup-${stamp}`;
    await cp(config.rimeDirectory, backup, { recursive: true, force: false });
    console.log(`[rime-bilingual] backed up existing Rime data to ${backup}`);
  }

  await mkdir(config.rimeDirectory, { recursive: true });
  await cp(sourceRime, config.rimeDirectory, {
    recursive: true,
    force: true,
    filter: source => !source.includes(`${join('vendor', 'rime-ice', '.git')}`),
  });
  await cp(join(integration, 'lua'), join(config.rimeDirectory, 'lua'), {
    recursive: true,
    force: true,
  });
  for (const name of [
    'double_pinyin_flypy.custom.yaml',
    'default.custom.yaml',
    'squirrel.custom.yaml',
  ]) {
    await cp(join(integration, name), join(config.rimeDirectory, name), {
      force: true,
    });
  }

  await mkdir(config.dataDirectory, { recursive: true });
  await cp(join(integration, 'bilingual', 'seed.tsv'), config.seedPath, {
    force: !alreadyInstalled,
  });
  for (const path of [
    config.dynamicPath,
    config.queuePath,
    config.cursorPath,
    config.failurePath,
    config.diagnosticPath,
  ]) {
    if (!(await exists(path))) {
      await writeFile(path, path === config.cursorPath ? '0\n' : '', 'utf8');
    }
    await secureFile(path);
  }
  await writeFile(config.versionPath, `${Date.now()}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  for (const path of [
    config.seedPath,
    config.dictionaryPath,
    config.versionPath,
    config.workerLogPath,
    config.workerErrorLogPath,
    join(config.projectRoot, '.env'),
  ]) {
    await secureFile(path);
  }
  await writeFile(marker, `${config.projectRoot}\n`, 'utf8');
}

async function bootstrapLaunchAgent(
  service: string,
  plistPath: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await execFileAsync('launchctl', [
        'bootstrap',
        `gui/${process.getuid?.() ?? 0}`,
        plistPath,
      ]);
      return;
    } catch (error) {
      lastError = error;
      try {
        await execFileAsync('launchctl', ['print', service]);
        return;
      } catch {
        await sleep(attempt * 500);
      }
    }
  }
  throw lastError;
}

async function installMacBackgroundWorker(config: AppConfig): Promise<string> {
  const launchAgents = join(homedir(), 'Library', 'LaunchAgents');
  const plistPath = join(launchAgents, 'com.local.rime-bilingual.plist');
  const candidates = ['/opt/homebrew/bin/node', '/usr/local/bin/node'];
  let nodePath = process.execPath;
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      nodePath = candidate;
      break;
    }
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.local.rime-bilingual</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(join(config.projectRoot, 'dist', 'worker.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(config.projectRoot)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RIME_BILINGUAL_LAUNCH_AGENT</key><string>1</string>
  </dict>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
`;
  await mkdir(launchAgents, { recursive: true });
  await writeFile(plistPath, plist, 'utf8');

  const service = `gui/${config.uid}/com.local.rime-bilingual`;
  await execFileAsync('launchctl', ['bootout', service]).catch(() => undefined);
  await sleep(500);
  await bootstrapLaunchAgent(service, plistPath);
  await execFileAsync('launchctl', ['kickstart', '-k', service]);
  return `LaunchAgent ${basename(plistPath)}`;
}

async function installWindowsBackgroundWorker(config: AppConfig): Promise<string> {
  const script = join(config.projectRoot, 'scripts', 'register-windows-task.ps1');
  if (!(await exists(script))) throw new Error(`Windows task script is missing: ${script}`);
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-NodePath',
    process.execPath,
    '-WorkerPath',
    join(config.projectRoot, 'dist', 'worker.js'),
    '-WorkingDirectory',
    config.projectRoot,
    '-TaskName',
    windowsTaskName,
  ]);
  return `Scheduled Task ${windowsTaskName}`;
}

export async function main(): Promise<void> {
  if (!['darwin', 'win32'].includes(process.platform)) {
    throw new Error(`installer currently supports macOS and Windows, not ${process.platform}`);
  }
  const config = getConfig();
  await installRimeFiles(config);
  const background =
    process.platform === 'darwin'
      ? await installMacBackgroundWorker(config)
      : await installWindowsBackgroundWorker(config);
  const frontend = await reloadRime();

  console.log(`[rime-bilingual] installed Rime files in ${config.rimeDirectory}`);
  console.log(`[rime-bilingual] background worker: ${background}`);
  console.log(`[rime-bilingual] deployed with ${frontend}; select 小鹤双拼`);
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMain) {
  void main().catch(error => {
    console.error('[rime-bilingual] installation failed:', error);
    process.exitCode = 1;
  });
}
