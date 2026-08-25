import {
  appendFile,
  chmod,
  mkdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { formatWithOptions } from 'node:util';

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function rotate(path: string, backups: number): Promise<void> {
  if (backups <= 0) {
    await rm(path, { force: true });
    return;
  }
  await rm(`${path}.${backups}`, { force: true });
  for (let index = backups - 1; index >= 1; index -= 1) {
    await renameIfPresent(`${path}.${index}`, `${path}.${index + 1}`);
  }
  await renameIfPresent(path, `${path}.1`);
}

export async function appendRotatingLine(
  path: string,
  line: string,
  maxBytes: number,
  backups = 2,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = line.endsWith('\n') ? line : `${line}\n`;
  if (
    maxBytes > 0 &&
    (await fileSize(path)) + Buffer.byteLength(content) > maxBytes
  ) {
    await rotate(path, backups);
  }
  await appendFile(path, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}

export interface WorkerLoggerOptions {
  infoPath: string;
  errorPath: string;
  maxBytes: number;
  backups?: number;
  mirrorConsole?: boolean;
}

export class WorkerLogger {
  constructor(private readonly options: WorkerLoggerOptions) {}

  async info(...values: unknown[]): Promise<void> {
    const line = this.format(values);
    await appendRotatingLine(
      this.options.infoPath,
      line,
      this.options.maxBytes,
      this.options.backups,
    );
    if (this.options.mirrorConsole) console.log(line);
  }

  async error(...values: unknown[]): Promise<void> {
    const line = this.format(values);
    await appendRotatingLine(
      this.options.errorPath,
      line,
      this.options.maxBytes,
      this.options.backups,
    );
    if (this.options.mirrorConsole) console.error(line);
  }

  private format(values: unknown[]): string {
    const message = formatWithOptions(
      { colors: false, depth: 5, breakLength: 120 },
      ...values,
    );
    return `${new Date().toISOString()} ${message}`;
  }
}
