import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const defaultCustomization = readFileSync(
  fileURLToPath(new URL('../rime/default.custom.yaml', import.meta.url)),
  'utf8',
);
const flypyCustomization = readFileSync(
  fileURLToPath(
    new URL('../rime/double_pinyin_flypy.custom.yaml', import.meta.url),
  ),
  'utf8',
);

describe('Rime default customization', () => {
  it('leaves Control+grave available to host applications such as VS Code', () => {
    expect(defaultCustomization).toContain('"switcher/hotkeys"');
    expect(defaultCustomization).not.toContain('Control+grave');
    expect(defaultCustomization).toContain('Control+Shift+grave');
  });

  it('loads the session-local selection keeper into the active schema', () => {
    expect(flypyCustomization).toContain(
      '"engine/processors/@before 6": lua_processor@*selection_keeper',
    );
  });

  it('loads the Shift+space bilingual commit processor before ascii_composer', () => {
    expect(flypyCustomization).toContain(
      '"engine/processors/@before 1": lua_processor@*bilingual_commit_processor',
    );
    expect(flypyCustomization).not.toContain(
      '"editor/bindings/Control+Shift+Return": commit_comment',
    );
  });
});
