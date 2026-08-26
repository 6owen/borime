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
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
