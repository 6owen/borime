import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './config.js';

const version = '1.1.2';
const nightly = process.argv.includes('--nightly');
const assetName = `Squirrel-${version}.pkg`;
const release = nightly ? 'latest' : version;
const defaultSource = `https://github.com/rime/squirrel/releases/download/${release}/${assetName}`;
const destinationDirectory = join(projectRoot, '.downloads');
const destination = join(
  destinationDirectory,
  nightly ? `Squirrel-${version}-nightly.pkg` : `Squirrel-${version}.pkg`,
);
const concurrency = 8;

interface GitHubRelease {
  assets: Array<{
    browser_download_url: string;
    name: string;
    size: number;
  }>;
}

async function getAsset(): Promise<{ source: string; size: number }> {
  if (nightly) {
    const response = await fetch(
      'https://api.github.com/repos/rime/squirrel/releases/tags/latest',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'rime-bilingual-ime',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub release API failed: ${response.status}`);
    }
    const releaseData = (await response.json()) as GitHubRelease;
    const asset = releaseData.assets.find(item => item.name === assetName);
    if (!asset || asset.size <= 0) throw new Error('nightly package not found');
    return { source: asset.browser_download_url, size: asset.size };
  }

  const metadata = await fetch(defaultSource, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!metadata.ok) throw new Error(`HEAD failed: ${metadata.status}`);
  const size = Number.parseInt(metadata.headers.get('content-length') ?? '', 10);
  if (!Number.isFinite(size) || size <= 0) throw new Error('asset size unavailable');
  return { source: defaultSource, size };
}

async function main(): Promise<void> {
  const { source, size } = await getAsset();

  await mkdir(destinationDirectory, { recursive: true });
  const partial = `${destination}.part`;
  const file = await open(partial, 'w');
  await file.truncate(size);
  let complete = false;
  try {
    const chunkSize = Math.ceil(size / concurrency);
    await Promise.all(
      Array.from({ length: concurrency }, async (_, index) => {
        const start = index * chunkSize;
        const end = Math.min(size - 1, start + chunkSize - 1);
        if (start > end) return;
        const response = await fetch(source, {
          redirect: 'follow',
          headers: { Range: `bytes=${start}-${end}` },
        });
        if (response.status !== 206) {
          throw new Error(`range ${index} returned HTTP ${response.status}`);
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length !== end - start + 1) {
          throw new Error(`range ${index} has unexpected length ${data.length}`);
        }
        await file.write(data, 0, data.length, start);
        console.log(`[squirrel] part ${index + 1}/${concurrency}`);
      }),
    );
    complete = true;
  } finally {
    await file.close();
    if (!complete) await rm(partial, { force: true });
  }
  await rename(partial, destination);
  console.log(destination);
}

void main().catch(error => {
  console.error('[squirrel] download failed:', error);
  process.exitCode = 1;
});
