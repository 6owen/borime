import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import {
  eventIdentity,
  formatDiagnosticEvent,
  parseDiagnosticEvents,
  type DiagnosticEvent,
} from './diagnostics.js';
import { readQueueStats, readText } from './store.js';
import { translateBatch } from './translator.js';

const sleep = (milliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function latestOf(
  events: DiagnosticEvent[],
  type: DiagnosticEvent['type'],
): DiagnosticEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return undefined;
}

function printAssessment(events: DiagnosticEvent[]): void {
  const success = latestOf(events, 'request_succeeded');
  const cached = latestOf(events, 'cache_written');
  const failed = latestOf(events, 'request_failed');
  const retry = latestOf(events, 'request_retry');

  console.log('\n判断：');
  if (!events.length) {
    console.log('- 尚无结构化事件；先运行 pnpm build && pnpm install:rime。');
    return;
  }
  if (success?.durationMs !== undefined) {
    console.log(`- 最近一次模型响应耗时 ${success.durationMs} ms。`);
  }
  if (cached) {
    console.log('- 最近有翻译写入缓存；已打开的候选窗不会自动刷新，需要重新输入。');
  }
  if (retry && (!cached || retry.timestamp > cached.timestamp)) {
    console.log(`- 最近请求发生过重试：${retry.error ?? '未知错误'}。`);
  }
  if (failed && (!cached || failed.timestamp > cached.timestamp)) {
    console.log(`- 最近批次最终失败：${failed.error ?? '未知错误'}。`);
  }
  const detected = latestOf(events, 'batch_detected');
  if (detected && (!cached || detected.timestamp > cached.timestamp)) {
    console.log('- 有候选进入队列但尚未看到缓存完成事件。');
  }
}

async function loadEvents(path: string): Promise<DiagnosticEvent[]> {
  return parseDiagnosticEvents(await readText(path));
}

async function printSnapshot(limit: number): Promise<DiagnosticEvent[]> {
  const config = getConfig();
  const [events, queue] = await Promise.all([
    loadEvents(config.diagnosticPath),
    readQueueStats(config.queuePath, config.cursorPath),
  ]);
  console.log('Rime 双语 AI 诊断');
  console.log(`模式：${config.baseURL ? 'OpenAI-compatible' : 'DeepSeek official'}`);
  console.log(`模型：${config.model}`);
  console.log(`API Key：${config.apiKey ? '已配置' : '未配置'}`);
  console.log(
    `时序：轮询 ${config.pollMs} ms + 防抖 ${config.debounceMs} ms；单次超时 ${config.timeoutMs} ms；最多重试 ${config.maxRetries} 次`,
  );
  console.log(`队列：${queue.pendingLines} 条待处理；${queue.historyLines} 条历史记录`);
  console.log(`事件文件：${config.diagnosticPath}`);
  console.log('\n最近事件：');
  for (const event of events.slice(-limit)) {
    console.log(`- ${formatDiagnosticEvent(event)}`);
  }
  if (!events.length) console.log('- 暂无');
  printAssessment(events);
  return events;
}

async function runProbe(text: string): Promise<boolean> {
  const config = getConfig();
  console.log(`\n直连模型探针：${text}`);
  const started = performance.now();
  try {
    const result = await translateBatch([text], config);
    const durationMs = Math.round(performance.now() - started);
    const translation = result.get(text);
    if (!translation) throw new Error('model response omitted the probe text');
    console.log(`成功：${durationMs} ms · ${translation}`);
    console.log('说明：这是模型/API 耗时，不含 Rime 入队、防抖和候选窗刷新。');
    return true;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`失败：${durationMs} ms · ${message}`);
    return false;
  }
}

async function watchEvents(
  path: string,
  initial: DiagnosticEvent[],
): Promise<never> {
  const seen = new Set(initial.map(eventIdentity));
  console.log('\n持续监视中；按 Control+C 退出。');
  process.once('SIGINT', () => {
    console.log('\n已停止监视。');
    process.exit(0);
  });
  while (true) {
    await sleep(500);
    for (const event of await loadEvents(path)) {
      const identity = eventIdentity(event);
      if (seen.has(identity)) continue;
      seen.add(identity);
      console.log(`- ${formatDiagnosticEvent(event)}`);
    }
  }
}

async function main(): Promise<void> {
  const parsedLimit = Number.parseInt(argument('--limit') ?? '12', 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 12;
  const events = await printSnapshot(limit);
  const probeIndex = process.argv.indexOf('--probe');
  if (probeIndex >= 0) {
    const text = argument('--probe') ?? '诊断翻译延迟';
    if (!(await runProbe(text))) process.exitCode = 1;
  }
  if (process.argv.includes('--watch')) {
    await watchEvents(getConfig().diagnosticPath, events);
  }
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMain) {
  void main().catch(error => {
    console.error('[rime-bilingual] diagnostics failed:', error);
    process.exitCode = 1;
  });
}
