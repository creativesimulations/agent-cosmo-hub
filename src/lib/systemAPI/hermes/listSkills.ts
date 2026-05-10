import { runHermesShell } from "./shell";

export type ListedSkill = {
  name: string;
  category: string;
  source: "user" | "bundled";
  description?: string;
  requiredSecrets?: string[];
};

export type ListSkillsResult = {
  success: boolean;
  skills: ListedSkill[];
  error?: string;
};

const LIST_SKILLS_CACHE_TTL_MS = 10_000;
let listSkillsCache: { at: number; value: ListSkillsResult } | null = null;

/** Clear cached skills list (e.g. after install) — optional hook for callers. */
export function invalidateListSkillsCache(): void {
  listSkillsCache = null;
}

/**
 * Scan ~/.hermes/skills and bundled site-packages skills; merge descriptions
 * and required secret hints from SKILL.md files.
 */
export async function fetchInstalledSkillsList(): Promise<ListSkillsResult> {
  if (listSkillsCache && Date.now() - listSkillsCache.at < LIST_SKILLS_CACHE_TTL_MS) {
    return {
      success: listSkillsCache.value.success,
      skills: listSkillsCache.value.skills.map((s) => ({ ...s })),
      error: listSkillsCache.value.error,
    };
  }
  const script = [
    "set +e",
    'export PATH="$HOME/.hermes/venv/bin:$HOME/.local/bin:$PATH"',
    'USER_SKILLS="$HOME/.hermes/skills"',
    'BUNDLED_SKILLS=""',
    'if [ -x "$HOME/.hermes/venv/bin/python" ]; then',
    '  BUNDLED_SKILLS="$($HOME/.hermes/venv/bin/python - <<PYEOF 2>/dev/null',
    'import importlib.util, os, sys',
    'for mod in ("hermes_agent", "hermes"):',
    '    spec = importlib.util.find_spec(mod)',
    '    if spec and spec.submodule_search_locations:',
    '        for loc in spec.submodule_search_locations:',
    '            cand = os.path.join(loc, "skills")',
    '            if os.path.isdir(cand):',
    '                print(cand); sys.exit(0)',
    "PYEOF",
    '  )"',
    "fi",
    "walk_skills() {",
    '  local root="$1" source="$2"',
    '  [ -d "$root" ] || return 0',
    '  for entry in "$root"/*; do',
    '    [ -d "$entry" ] || continue',
    '    name="$(basename "$entry")"',
    '    if [ -f "$entry/SKILL.md" ] || [ -f "$entry/skill.md" ] || [ -f "$entry/__init__.py" ] || [ -f "$entry/skill.yaml" ]; then',
    '      desc=""',
    '      for d in "$entry/SKILL.md" "$entry/skill.md"; do',
    '        if [ -f "$d" ]; then desc="$d"; break; fi',
    "      done",
    '      printf "%s\\t%s\\t%s\\t%s\\n" "$source" "general" "$name" "$desc"',
    "      continue",
    "    fi",
    '    for sub in "$entry"/*; do',
    '      [ -d "$sub" ] || continue',
    '      sub_name="$(basename "$sub")"',
    '      desc=""',
    '      for d in "$sub/SKILL.md" "$sub/skill.md"; do',
    '        if [ -f "$d" ]; then desc="$d"; break; fi',
    "      done",
    '      printf "%s\\t%s\\t%s\\t%s\\n" "$source" "$name" "$sub_name" "$desc"',
    "    done",
    "  done",
    "}",
    'walk_skills "$USER_SKILLS" user',
    'if [ -n "$BUNDLED_SKILLS" ]; then walk_skills "$BUNDLED_SKILLS" bundled; fi',
    "exit 0",
  ].join("\n");

  const result = await runHermesShell(script, { timeout: 30000 });
  if (!result.success && !result.stdout) {
    return { success: false, skills: [], error: result.stderr || "Failed to list skills" };
  }

  const seen = new Set<string>();
  const skills: ListedSkill[] = [];
  const descPaths: Array<{ key: string; path: string }> = [];

  for (const line of (result.stdout || "").split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [source, category, name, descPath] = parts;
    if (!name) continue;
    const key = `${category}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const skill: ListedSkill = {
      name,
      category: category || "general",
      source: (source === "user" ? "user" : "bundled") as "user" | "bundled",
    };
    skills.push(skill);
    if (descPath) descPaths.push({ key, path: descPath });
  }

  if (descPaths.length > 0) {
    const descScript = descPaths
      .map(
        ({ key, path }) =>
          `printf "DESC\\t%s\\t" "${key}"; head -n 20 "${path}" 2>/dev/null | grep -m1 -E "^[A-Za-z]" | head -c 200; printf "\\n"; ` +
          `printf "ENV\\t%s\\t" "${key}"; cat "${path}" 2>/dev/null | grep -oE "[A-Z][A-Z0-9_]{3,}_(API_KEY|TOKEN|SECRET|PASSWORD|HOST|USER|PASS|ID|URL|BEARER_TOKEN|ACCESS_TOKEN|CLIENT_ID|CLIENT_SECRET|VERIFY_TOKEN|PHONE_NUMBER_ID)" | sort -u | tr "\\n" "," | head -c 500; printf "\\n"`,
      )
      .join("\n");
    const descResult = await runHermesShell(descScript, { timeout: 20000 });
    const descMap = new Map<string, string>();
    const envMap = new Map<string, string[]>();
    for (const line of (descResult.stdout || "").split("\n")) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const [tag, key, ...rest] = parts;
      const value = rest.join("\t").trim();
      if (tag === "DESC" && value) descMap.set(key, value);
      if (tag === "ENV" && value) {
        const vars = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (vars.length) envMap.set(key, Array.from(new Set(vars)));
      }
    }
    for (const skill of skills) {
      const k = `${skill.category}/${skill.name}`;
      const d = descMap.get(k);
      if (d) skill.description = d;
      const e = envMap.get(k);
      if (e && e.length) skill.requiredSecrets = e;
    }
  }

  skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const finalResult: ListSkillsResult = { success: true, skills };
  listSkillsCache = { at: Date.now(), value: finalResult };
  return finalResult;
}
