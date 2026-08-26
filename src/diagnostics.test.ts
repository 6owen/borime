import { describe, expect, it } from 'vitest';
import {
  eventIdentity,
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
});
