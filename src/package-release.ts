import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { projectRoot } from './config.js';

const execFileAsync = promisify(execFile);

export const releaseEntries = [
  '.env.example',
  '.gitmodules',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'docs',
  'dist',
  'package.json',
  'pnpm-lock.yaml',
  'rime',
  'scripts',
  'src',
  'tests',
  'tsconfig.json',
  'vendor/rime-ice',
] as const;

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function createZip(
  releaseRoot: string,
  bundleName: string,
): Promise<string> {
  const archiveName = `${bundleName}.zip`;
  const archivePath = join(releaseRoot, archiveName);
  await rm(archivePath, { force: true });
  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath '${join(releaseRoot, bundleName).replaceAll("'", "''")}' -DestinationPath '${archivePath.replaceAll("'", "''")}' -Force`,
    ]);
  } else {
    await execFileAsync('zip', ['-qr', archiveName, bundleName], {
      cwd: releaseRoot,
    });
  }
  return archivePath;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(projectRoot, 'package.json'), 'utf8'),
  ) as { name: string; version: string };
  const bundleName = `${manifest.name}-v${manifest.version}`;
  const releaseRoot = join(projectRoot, '.release');
  const bundleRoot = join(releaseRoot, bundleName);
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });

  for (const entry of releaseEntries) {
    await cp(join(projectRoot, entry), join(bundleRoot, entry), {
      recursive: true,
      force: true,
      filter: source => basename(source) !== '.git',
    });
  }
  await writeFile(
    join(bundleRoot, 'PACKAGE_CONTENTS.txt'),
    [
      `${manifest.name} ${manifest.version}`,
      'Portable source bundle for macOS Squirrel and Windows Weasel.',
      'Secrets, personal Rime user dictionaries, AI cache, queues, and logs are excluded.',
      '',
    ].join('\n'),
    'utf8',
  );

  const archivePath = await createZip(releaseRoot, bundleName);
  const checksum = await sha256(archivePath);
  await writeFile(
    `${archivePath}.sha256`,
    `${checksum}  ${basename(archivePath)}\n`,
    'utf8',
  );
  console.log(archivePath);
  console.log(`${archivePath}.sha256`);
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMain) {
  void main().catch(error => {
    console.error('[rime-bilingual] release packaging failed:', error);
    process.exitCode = 1;
  });
}
