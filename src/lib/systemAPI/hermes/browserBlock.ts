import { BROWSER_BEGIN, BROWSER_END } from './managedBlocks';

/**
 * Managed `browser:` block state in ~/.hermes/config.yaml.
 * Used when reading or surgically rewriting the Ronbot-managed block.
 */
export interface BrowserBlockState {
  camofoxPersistence: boolean;
  cdpUrl: string | null;
}

export function parseBrowserBlock(yaml: string): BrowserBlockState {
  const startIdx = yaml.indexOf(BROWSER_BEGIN);
  const state: BrowserBlockState = { camofoxPersistence: false, cdpUrl: null };
  if (startIdx === -1) return state;
  const endIdx = yaml.indexOf(BROWSER_END, startIdx);
  if (endIdx === -1) return state;
  const block = yaml.slice(startIdx, endIdx);
  if (/managed_persistence:\s*true/.test(block)) state.camofoxPersistence = true;
  const cdpMatch = block.match(/cdp_url:\s*"?([^"\n]+)"?/);
  if (cdpMatch) state.cdpUrl = cdpMatch[1].trim();
  return state;
}
