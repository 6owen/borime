import { describe, expect, it } from 'vitest';
import {
  cleanCell,
  parseTranslationTsv,
  serializeTranslationTsv,
} from './store.js';

describe('translation TSV', () => {
  it('round trips sanitized entries', () => {
    const original = new Map([
      ['我的帽子', 'my hat'],
      ['谢谢', 'thank you'],
    ]);
    expect(parseTranslationTsv(serializeTranslationTsv(original))).toEqual(original);
  });

  it('ignores comments and invalid rows', () => {
    expect(parseTranslationTsv('# comment\n坏行\n你好\thello\n')).toEqual(
      new Map([['你好', 'hello']]),
    );
  });

  it('removes tabs and newlines from cells', () => {
    expect(cleanCell('a\tb\n c')).toBe('a b c');
  });
});
