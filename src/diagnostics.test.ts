import { describe, expect, it } from 'vitest';
import {
  eventIdentity,
  eventsSinceLastWorkerStart,
  formatDiagnosticEvent,
  parseDiagnosticEvents,
} from './diagnostics.js';

describe('translation diagnostics', () => {
  it('ignores partial lines and parses structured events', () => {
    const events = parseDiagnosticEvents(
      '{"timestamp":"2026-08-26T01:00:00.000Z","type":"request_started","batchId":"b1"}\n{broken',
    );
    expect(events).toHaveLength(1);
    expect(eventIdentity(events[0])).toBe(
      '2026-08-26T01:00:00.000Z\trequest_started\tb1',
    );
  });

  it('makes cache visibility and latency explicit', () => {
    expect(
      formatDiagnosticEvent({
        timestamp: '2026-08-26T01:00:05.000Z',
        type: 'cache_written',
        durationMs: 4374,
        texts: ['诊断翻译延迟'],
      }),
    ).toContain('4374 ms');
    expect(
      formatDiagnosticEvent({
        timestamp: '2026-08-26T01:00:05.000Z',
        type: 'cache_written',
      }),
    ).toContain('retype to refresh');
  });

  it('does not diagnose failures from a previous worker process', () => {
    const previousFailure = {
      timestamp: '2026-08-26T01:00:00.000Z',
      type: 'request_failed' as const,
    };
    const workerReady = {
      timestamp: '2026-08-26T01:01:00.000Z',
      type: 'worker_ready' as const,
    };
    expect(
      eventsSinceLastWorkerStart([previousFailure, workerReady]),
    ).toEqual([workerReady]);
  });

  it('shows when newer input cancels an active model request', () => {
    expect(
      formatDiagnosticEvent({
        timestamp: '2026-08-26T01:00:05.000Z',
        type: 'request_superseded',
        durationMs: 251,
        texts: ['旧候选'],
      }),
    ).toContain('stale model request cancelled 251 ms');
  });
});
