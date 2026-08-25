import { describe, expect, it } from 'vitest';
import { parseCedict } from './import-cedict.js';

describe('CC-CEDICT import', () => {
  it('uses simplified headwords and concise English definitions', () => {
    const content = [
      '# comment',
      '帽子 帽子 [mao4 zi5] /hat/cap/',
      '蘋果 苹果 [ping2 guo3] /apple/CL:個|个[ge4]/',
    ].join('\n');

    expect(parseCedict(content)).toEqual(
      new Map([
        ['帽子', 'hat'],
        ['苹果', 'apple'],
      ]),
    );
  });

  it('deprioritizes cross references', () => {
    const content = [
      '著 著 [zhu4] /variant of 著|着[zhe5]/to write/',
    ].join('\n');
    expect(parseCedict(content).get('著')).toBe('to write');
  });
});
