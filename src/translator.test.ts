import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  normalizeTranslation,
  parseCompatibleTranslationResponse,
  translateBatch,
} from './translator.js';

describe('normalizeTranslation', () => {
  it('removes wrapping quotes and whitespace', () => {
    expect(normalizeTranslation('  “my   hat”\n')).toBe('my hat');
  });

  it('removes wrapping parentheses to avoid nested output', () => {
    expect(normalizeTranslation('(thank you)')).toBe('thank you');
  });

  it('parses fenced JSON returned by compatible chat models', () => {
    expect(
      parseCompatibleTranslationResponse(
        '```json\n{"translations":[{"source":"你好","english":"hello"}]}\n```',
      ),
    ).toEqual({
      translations: [{ source: '你好', english: 'hello' }],
    });
  });
});

describe('OpenAI-compatible translation', () => {
  it('does not require response_format support', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >;
      response.setHeader('Content-Type', 'application/json');
      if (requestBody.response_format) {
        response.statusCode = 400;
        response.end(
          JSON.stringify({
            error: {
              message: 'This response_format type is unavailable now',
              type: 'invalid_request_error',
            },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          id: 'test-completion',
          created: 1,
          model: 'test-model',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '{"translations":[{"source":"你好","english":"hello"}]}',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    try {
      await expect(
        translateBatch(['你好'], {
          apiKey: 'test-key',
          baseURL: `http://127.0.0.1:${port}/v1`,
          model: 'test-model',
          timeoutMs: 2_000,
          maxOutputTokens: 256,
        }),
      ).resolves.toEqual(new Map([['你好', 'hello']]));
      expect(requestBody).not.toHaveProperty('response_format');
      expect(requestBody).toHaveProperty('thinking', { type: 'disabled' });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('forwards cancellation to the active HTTP request', async () => {
    let markRequestSeen: (() => void) | undefined;
    const requestSeen = new Promise<void>(resolve => {
      markRequestSeen = resolve;
    });
    const server = createServer(async request => {
      for await (const _chunk of request) {
        // Drain the request before announcing that the model call is active.
      }
      markRequestSeen?.();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();

    try {
      const translation = translateBatch(
        ['旧候选'],
        {
          apiKey: 'test-key',
          baseURL: `http://127.0.0.1:${port}/v1`,
          model: 'test-model',
          timeoutMs: 2_000,
          maxOutputTokens: 256,
        },
        controller.signal,
      );
      await requestSeen;
      controller.abort(new DOMException('newer input arrived', 'AbortError'));
      await expect(translation).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
  });

  it('isolates each candidate so one truncated batch cannot lose every translation', async () => {
    let requestCount = 0;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      requestCount += 1;
      const prompt = body.messages?.findLast(message => message.role === 'user')
        ?.content ?? '';
      const arrayStart = prompt.indexOf('[');
      const sources = JSON.parse(prompt.slice(arrayStart)) as string[];
      response.setHeader('Content-Type', 'application/json');
      const content = sources.length === 1
        ? JSON.stringify({
            translations: [{ source: sources[0], english: `en:${sources[0]}` }],
          })
        : '{"translations":[';
      response.end(JSON.stringify({
        id: `completion-${requestCount}`,
        created: 1,
        model: 'test-model',
        choices: [{
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    try {
      await expect(
        translateBatch(['甲', '乙', '丙'], {
          apiKey: 'test-key',
          baseURL: `http://127.0.0.1:${port}/v1`,
          model: 'test-model',
          timeoutMs: 2_000,
          maxOutputTokens: 256,
        }),
      ).resolves.toEqual(new Map([
        ['甲', 'en:甲'],
        ['乙', 'en:乙'],
        ['丙', 'en:丙'],
      ]));
      expect(requestCount).toBe(3);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
