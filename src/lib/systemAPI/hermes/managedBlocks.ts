/** Sentinel pairs for Ronbot-managed YAML regions in ~/.hermes/config.yaml */

export const PERMS_BEGIN = "# ─── Managed by Ronbot: permissions (do not edit) ───";
export const PERMS_END = "# ─── End Ronbot permissions ───";
export const LOG_BEGIN = "# ─── Managed by Ronbot: logging (do not edit) ───";
export const LOG_END = "# ─── End Ronbot logging ───";
export const BROWSER_BEGIN = "# ─── Managed by Ronbot: browser (do not edit) ───";
export const BROWSER_END = "# ─── End Ronbot browser ───";
export const TOOLSETS_BEGIN = "# ─── Managed by Ronbot: toolsets (do not edit) ───";
export const TOOLSETS_END = "# ─── End Ronbot toolsets ───";

export const stripManagedBlock = (yaml: string, begin: string, end: string): string => {
  const startIdx = yaml.indexOf(begin);
  if (startIdx === -1) return yaml;
  const endIdx = yaml.indexOf(end, startIdx);
  if (endIdx === -1) return yaml;
  const after = yaml.slice(endIdx + end.length);
  return (yaml.slice(0, startIdx).replace(/\n+$/, "") + after.replace(/^\n+/, "\n")).replace(
    /\n{3,}/g,
    "\n\n",
  );
};

export const yamlList = (items: string[]): string => {
  if (!items.length) return " []";
  return "\n" + items.map((p) => `    - "${p.replace(/"/g, '\\"')}"`).join("\n");
};

/**
 * Remove an existing managed region and append a new block (with sentinels).
 * `blockBody` should be the inner lines only (not including begin/end sentinels).
 */
export const buildManagedBlockYaml = (
  existingYaml: string,
  begin: string,
  end: string,
  blockBodyLines: string[],
): string => {
  const stripped = stripManagedBlock(existingYaml, begin, end).replace(/\n+$/, "");
  const block = [begin, ...blockBodyLines, end].join("\n");
  return `${stripped}\n\n${block}\n`;
};
