import { describe, expect, it } from 'vitest';
import { mergeTranslationCaches } from './translation-cache.js';

describe('mergeTranslationCaches', () => {
  it('keeps local values and lets the imported cache update duplicates', () => {
    expect(
      mergeTranslationCaches(
        new Map([
          ['本机', 'local machine'],
          ['共同', 'old'],
        ]),
        new Map([
          ['另一台', 'another machine'],
          ['共同', 'shared'],
        ]),
      ),
    ).toEqual(
      new Map([
        ['本机', 'local machine'],
        ['共同', 'shared'],
        ['另一台', 'another machine'],
      ]),
    );
  });
});
