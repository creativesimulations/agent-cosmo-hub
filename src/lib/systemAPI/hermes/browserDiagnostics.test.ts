import { describe, expect, it } from 'vitest';
import { collectBrowserDiagnostics } from './browserDiagnostics';
import {
  BROWSER_BEGIN,
  BROWSER_END,
  PERMS_BEGIN,
  PERMS_END,
  TOOLSETS_BEGIN,
  TOOLSETS_END,
} from './managedBlocks';

describe('collectBrowserDiagnostics', () => {
  it('returns empty diagnostics for empty yaml', async () => {
    const r = await collectBrowserDiagnostics('', null);
    expect(r.browserEnabledInConfig).toBe(false);
    expect(r.hermesWebToolsetLoaded).toBe(false);
    expect(r.rawBrowserBlock).toBeNull();
    expect(r.rawToolsetsBlock).toBeNull();
    expect(r.internetPermission).toBeNull();
    expect(r.cdpUrl).toBeNull();
  });

  it('parses internet from permissions block', async () => {
    const permsBlock = `${PERMS_BEGIN}\n  internet: deny\n${PERMS_END}`;
    const r = await collectBrowserDiagnostics('model: x\n', permsBlock);
    expect(r.internetPermission).toBe('deny');
  });

  it('detects hermes-cli toolset line', async () => {
    const r = await collectBrowserDiagnostics('toolsets:\n  - hermes-cli\n', null);
    expect(r.hermesWebToolsetLoaded).toBe(true);
  });

  it('exposes raw managed blocks when present', async () => {
    const yaml = `x: 1\n\n${BROWSER_BEGIN}\nbrowser: {}\n${BROWSER_END}\n\n${TOOLSETS_BEGIN}\ntoolsets: []\n${TOOLSETS_END}\n`;
    const r = await collectBrowserDiagnostics(yaml, null);
    expect(r.rawBrowserBlock).toContain(BROWSER_BEGIN);
    expect(r.rawToolsetsBlock).toContain(TOOLSETS_BEGIN);
    expect(r.browserEnabledInConfig).toBe(true);
  });
});
