import { describe, expect, it } from 'vitest';
import { normalizeTranslation } from './translator.js';

describe('normalizeTranslation', () => {
  it('removes wrapping quotes and whitespace', () => {
    expect(normalizeTranslation('  “my   hat”\n')).toBe('my hat');
  });

  it('removes wrapping parentheses to avoid nested output', () => {
    expect(normalizeTranslation('(thank you)')).toBe('thank you');
  });
});
