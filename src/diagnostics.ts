import { appendRotatingLine } from './logger.js';

export type DiagnosticEventType =
  | 'worker_ready'
  | 'batch_detected'
  | 'batch_superseded'
  | 'api_key_missing'
  | 'request_started'
  | 'request_superseded'
  | 'request_retry'
  | 'request_succeeded'
  | 'cache_written'
  | 'request_failed';

export interface DiagnosticEvent {
  timestamp: string;
  type: DiagnosticEventType;
  batchId?: string;
  texts?: string[];
  model?: string;
  durationMs?: number;
  debounceMs?: number;
  attempt?: number;
  maxRetries?: number;
  delayMs?: number;
  error?: string;
}

export async function appendDiagnosticEvent(
  path: string,
  maxBytes: number,
  event: Omit<DiagnosticEvent, 'timestamp'>,
): Promise<void> {
  await appendRotatingLine(
    path,
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }),
    maxBytes,
  );
}

export function parseDiagnosticEvents(content: string): DiagnosticEvent[] {
  const events: DiagnosticEvent[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<DiagnosticEvent>;
      if (
        typeof value.timestamp === 'string' &&
        typeof value.type === 'string'
      ) {
        events.push(value as DiagnosticEvent);
      }
    } catch {
      // A partially written or legacy line must not make diagnostics unusable.
    }
  }
  return events;
}

function textSummary(texts: string[] | undefined): string {
  return texts?.length ? ` [${texts.join(' / ')}]` : '';
}

export function formatDiagnosticEvent(event: DiagnosticEvent): string {
  const parsedTime = new Date(event.timestamp);
  const time = Number.isNaN(parsedTime.valueOf())
    ? event.timestamp
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(parsedTime);
  const duration =
    event.durationMs === undefined ? '' : ` ${event.durationMs} ms`;
  const texts = textSummary(event.texts);
  switch (event.type) {
    case 'worker_ready':
      return `${time} worker ready · ${event.model ?? 'unknown model'}`;
    case 'batch_detected':
      return `${time} candidates queued${texts} · debounce ${event.debounceMs ?? 0} ms`;
    case 'batch_superseded':
      return `${time} batch superseded while typing${duration}${texts}`;
    case 'api_key_missing':
      return `${time} blocked · API key missing${texts}`;
    case 'request_started':
      return `${time} model request started${duration}${texts}`;
    case 'request_superseded':
      return `${time} stale model request cancelled${duration}${texts}`;
    case 'request_retry':
      return `${time} retry ${event.attempt ?? '?'} · waited${duration}, next in ${event.delayMs ?? 0} ms · ${event.error ?? 'unknown error'}`;
    case 'request_succeeded':
      return `${time} model returned${duration}${texts}`;
    case 'cache_written':
      return `${time} cache ready${duration}${texts} · retype to refresh the candidate window`;
    case 'request_failed':
      return `${time} request failed${duration}${texts} · ${event.error ?? 'unknown error'}`;
  }
}

export function eventIdentity(event: DiagnosticEvent): string {
  return `${event.timestamp}\t${event.type}\t${event.batchId ?? ''}`;
}

export function eventsSinceLastWorkerStart(
  events: DiagnosticEvent[],
): DiagnosticEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === 'worker_ready') return events.slice(index);
  }
  return events;
}
