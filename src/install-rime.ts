import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getConfig } from './config.js';

const execFileAsync = promisify(execFile);
const sleep = (milliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

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

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function directoryHasFiles(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length > 0;
  } catch {
    return false;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  const sourceRime = join(config.projectRoot, 'vendor', 'rime-ice');
  const integration = join(config.projectRoot, 'rime');
  const marker = join(config.rimeDirectory, '.rime-bilingual-installed');

  let alreadyInstalled = false;
  try {
    await readFile(marker, 'utf8');
    alreadyInstalled = true;
  } catch {
    alreadyInstalled = false;
  }

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
  await cp(
    join(integration, 'double_pinyin_flypy.custom.yaml'),
    join(config.rimeDirectory, 'double_pinyin_flypy.custom.yaml'),
    { force: true },
  );
  await cp(
    join(integration, 'default.custom.yaml'),
    join(config.rimeDirectory, 'default.custom.yaml'),
    { force: true },
  );
  await mkdir(config.dataDirectory, { recursive: true });
  await cp(join(integration, 'bilingual', 'seed.tsv'), config.seedPath, {
    force: !alreadyInstalled,
  });
  for (const path of [
    config.dynamicPath,
    config.queuePath,
    config.cursorPath,
    config.failurePath,
  ]) {
    try {
      await readFile(path);
    } catch {
      await writeFile(path, path === config.cursorPath ? '0\n' : '', 'utf8');
    }
    await chmod(path, 0o600);
  }
  for (const path of [
    config.seedPath,
    config.dictionaryPath,
    config.versionPath,
    config.workerLogPath,
    config.workerErrorLogPath,
    join(config.projectRoot, '.env'),
  ]) {
    await chmod(path, 0o600).catch(() => undefined);
  }
  await writeFile(config.versionPath, `${Date.now()}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await writeFile(marker, `${config.projectRoot}\n`, 'utf8');

  const launchAgents = join(homedir(), 'Library', 'LaunchAgents');
  const plistPath = join(launchAgents, 'com.local.rime-bilingual.plist');
  const stableHomebrewNode = '/opt/homebrew/bin/node';
  const nodePath = (await isExecutable(stableHomebrewNode))
    ? stableHomebrewNode
    : process.execPath;
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

  console.log(`[rime-bilingual] installed Rime files in ${config.rimeDirectory}`);
  console.log(`[rime-bilingual] LaunchAgent: ${basename(plistPath)}`);
  console.log('[rime-bilingual] deploy Rime, then select 小鹤双拼 from the input menu');
}

void main().catch(error => {
  console.error('[rime-bilingual] installation failed:', error);
  process.exitCode = 1;
});
