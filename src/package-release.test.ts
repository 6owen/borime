import { describe, expect, it } from 'vitest';
import { releaseEntries } from './package-release.js';

describe('release package allowlist', () => {
  it('excludes secrets and runtime data', () => {
    expect(releaseEntries).not.toContain('.env');
    expect(releaseEntries).not.toContain('node_modules');
    expect(releaseEntries).not.toContain('.downloads');
    expect(releaseEntries).not.toContain('.git');
  });
});
