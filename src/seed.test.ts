import { describe, expect, it } from 'vitest';
import { extractCommonEntries } from './seed.js';

describe('extractCommonEntries', () => {
  it('keeps Han phrases and sorts by weight', () => {
    const content = `---\nname: test\n...\n你好\tni hao\t100\n世界\tshi jie\t200\nA股\ta gu\t999\n单\tdan\t500\n`;
    expect(extractCommonEntries(content)).toEqual([
      { text: '世界', weight: 200 },
      { text: '你好', weight: 100 },
    ]);
  });
});
