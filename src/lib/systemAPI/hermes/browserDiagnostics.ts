import { BROWSER_BEGIN, BROWSER_END, TOOLSETS_BEGIN, TOOLSETS_END } from './managedBlocks';
import { parseBrowserBlock } from './browserBlock';

export interface HermesBrowserDiagnostics {
  cdpUrl: string | null;
  cdpReachable: boolean | null;
  cdpVersion?: string;
  browserEnabledInConfig: boolean;
  hermesWebToolsetLoaded: boolean;
  internetPermission: string | null;
  rawBrowserBlock: string | null;
  rawToolsetsBlock: string | null;
}

/**
 * Derive browser / toolset / CDP diagnostics from config YAML and the
 * managed permissions block text (already loaded by the caller).
 */
export async function collectBrowserDiagnostics(
  yaml: string,
  permsBlock: string | null,
): Promise<HermesBrowserDiagnostics> {
  const bIdx = yaml.indexOf(BROWSER_BEGIN);
  const bEnd = yaml.indexOf(BROWSER_END, bIdx);
  const rawBrowserBlock =
    bIdx !== -1 && bEnd !== -1 ? yaml.slice(bIdx, bEnd + BROWSER_END.length) : null;
  const browserState = parseBrowserBlock(yaml);
  const browserEnabledInConfig = !!rawBrowserBlock;

  const tIdx = yaml.indexOf(TOOLSETS_BEGIN);
  const tEnd = yaml.indexOf(TOOLSETS_END, tIdx);
  const rawToolsetsBlock =
    tIdx !== -1 && tEnd !== -1 ? yaml.slice(tIdx, tEnd + TOOLSETS_END.length) : null;
  const hermesWebToolsetLoaded =
    /(^|\n)\s*-\s*hermes-cli\b/.test(yaml) || /(^|\n)\s*-\s*hermes-web\b/.test(yaml);

  const internetMatch = permsBlock?.match(/^\s*internet:\s*(\w+)/m);
  const internetPermission = internetMatch ? internetMatch[1] : null;

  let cdpReachable: boolean | null = null;
  let cdpVersion: string | undefined;
  if (browserState.cdpUrl) {
    try {
      const probeUrl = browserState.cdpUrl.replace(/\/+$/, '') + '/json/version';
      const resp = await fetch(probeUrl, { method: 'GET' });
      cdpReachable = resp.ok;
      if (resp.ok) {
        const json = await resp.json().catch(() => ({} as { Browser?: string }));
        cdpVersion = (json as { Browser?: string }).Browser;
      }
    } catch {
      cdpReachable = false;
    }
  }

  return {
    cdpUrl: browserState.cdpUrl,
    cdpReachable,
    cdpVersion,
    browserEnabledInConfig,
    hermesWebToolsetLoaded,
    internetPermission,
    rawBrowserBlock,
    rawToolsetsBlock,
  };
}
