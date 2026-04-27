import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SECRET_PRESETS,
  type SecretPreset,
  findPresetByEnvVar,
  detectPresetFromValue,
  isValidEnvVarName,
  normalizeEnvVarName,
} from "@/lib/secretPresets";
import { cn } from "@/lib/utils";
import { supportsLiveKeyTest, testKeyNow } from "@/lib/secretKeyTests";

interface SecretFormProps {
  /** Initial canonical env var name (e.g. from a deep-link "Add missing key"). */
  initialEnvVar?: string;
  initialValue?: string;
  saving: boolean;
  onSave: (envVar: string, value: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Smart "add a secret" form with three pathways:
 *   1. Pick a curated preset → env var name + hint auto-filled.
 *   2. Paste a value → prefix sniff suggests the right preset (sk-or- → OpenRouter).
 *   3. Type a custom name → free-form fallback for anything not in the catalog.
 *
 * The env var name is always normalized (uppercase, underscores) so we never
 * end up with bash-breaking names like OPENROUTER-API-KEY.
 */
const SecretForm = ({ initialEnvVar = "", initialValue = "", saving, onSave, onCancel }: SecretFormProps) => {
  const initialPreset = initialEnvVar ? findPresetByEnvVar(initialEnvVar) : null;
  const [preset, setPreset] = useState<SecretPreset | null>(initialPreset);
  const [envVar, setEnvVar] = useState(initialEnvVar);
  const [value, setValue] = useState(initialValue);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [autoDetectedFor, setAutoDetectedFor] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Group presets by category for the picker.
  const groups = useMemo(() => {
    const map = new Map<SecretPreset["category"], SecretPreset[]>();
    for (const p of SECRET_PRESETS) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return Array.from(map.entries());
  }, []);

  const selectPreset = (p: SecretPreset | null) => {
    setPreset(p);
    setPickerOpen(false);
    if (p) setEnvVar(p.envVar);
  };

  const handleValuePaste = (raw: string) => {
    setValue(raw);
    setTestResult(null);
    // Only auto-pick when the user hasn't already chosen a preset / typed a name.
    if (preset || envVar) return;
    if (raw === autoDetectedFor) return;
    const detected = detectPresetFromValue(raw);
    if (detected) {
      setAutoDetectedFor(raw);
      setPreset(detected);
      setEnvVar(detected.envVar);
    }
  };

  const handleEnvVarChange = (raw: string) => {
    // Normalize as the user types (uppercase, hyphens → underscores).
    const normalized = normalizeEnvVarName(raw);
    setEnvVar(normalized);
    // If they type away from a preset, drop it.
    if (preset && normalized !== preset.envVar) setPreset(null);
    setTestResult(null);
  };

  const normalizedEnvVar = normalizeEnvVarName(envVar);
  const envValid = !!normalizedEnvVar && isValidEnvVarName(normalizedEnvVar);
  const prefixMismatch =
    !!preset && !!preset.prefix && !!value && !value.startsWith(preset.prefix);
  const canTest = supportsLiveKeyTest(normalizedEnvVar);

  const handleTestNow = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testKeyNow(normalizedEnvVar, value);
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Service</label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={pickerOpen}
              className="w-full justify-between bg-background/50 border-white/10 font-normal"
            >
              {preset ? (
                <span className="flex items-center gap-2 truncate">
                  <span className="truncate">{preset.label}</span>
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {preset.envVar}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Pick a service or type a custom name below…
                </span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search services…" />
              <CommandList>
                <CommandEmpty>
                  No matching service. Use the field below for custom names.
                </CommandEmpty>
                {groups.map(([category, items]) => (
                  <CommandGroup key={category} heading={category}>
                    {items.map((p) => (
                      <CommandItem
                        key={p.envVar}
                        value={`${p.label} ${p.envVar}`}
                        onSelect={() => selectPreset(p)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            preset?.envVar === p.envVar ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{p.label}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">
                            {p.envVar}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {preset && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span>{preset.hint}</span>
              {preset.docsUrl && (
                <a
                  href={preset.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  Get key <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {canTest && (
                <button
                  type="button"
                  onClick={() => void handleTestNow()}
                  disabled={!value.trim() || testing}
                  className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-60 disabled:no-underline"
                >
                  {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Test key now
                </button>
              )}
            </p>
            {testResult && (
              <p className={cn("text-[11px]", testResult.ok ? "text-success" : "text-warning")}>
                {testResult.message}
              </p>
            )}
            {(() => {
              // Multi-field credential helpers — most users don't realize SMTP
              // needs four entries together, not one. Surface companions inline.
              const companions: Record<string, string[]> = {
                EMAIL_ADDRESS: ["EMAIL_PASSWORD", "EMAIL_IMAP_HOST", "EMAIL_SMTP_HOST"],
                EMAIL_PASSWORD: ["EMAIL_ADDRESS", "EMAIL_IMAP_HOST", "EMAIL_SMTP_HOST"],
                EMAIL_IMAP_HOST: ["EMAIL_ADDRESS", "EMAIL_PASSWORD", "EMAIL_SMTP_HOST"],
                EMAIL_SMTP_HOST: ["EMAIL_ADDRESS", "EMAIL_PASSWORD", "EMAIL_IMAP_HOST"],
                SLACK_BOT_TOKEN: ["SLACK_APP_TOKEN"],
                SLACK_APP_TOKEN: ["SLACK_BOT_TOKEN"],
                BROWSERBASE_API_KEY: ["BROWSERBASE_PROJECT_ID"],
                BROWSERBASE_PROJECT_ID: ["BROWSERBASE_API_KEY"],
              };
              const c = companions[preset.envVar];
              if (!c) return null;
              return (
                <p className="text-[11px] text-warning/90 bg-warning/5 border border-warning/20 rounded px-2 py-1.5">
                  This service also needs:{" "}
                  {c.map((v, i) => (
                    <span key={v}>
                      <code className="text-foreground">{v}</code>
                      {i < c.length - 1 ? ", " : ""}
                    </span>
                  ))}
                  . Add each one as a separate secret.
                </p>
              );
            })()}
          </div>
        )}
        {!preset && (
          <p className="text-[11px] text-muted-foreground/80">
            Don't see your service? Skills look for very specific names — open the{" "}
            <strong className="text-foreground">Skills &amp; Tools</strong> tab to see exactly
            what name a skill expects, then come back here to add it.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Variable name</label>
          <Input
            value={envVar}
            onChange={(e) => handleEnvVarChange(e.target.value)}
            placeholder="OPENAI_API_KEY"
            className="bg-background/50 border-white/10 font-mono text-sm"
          />
          {envVar && !envValid && (
            <p className="text-[11px] text-destructive">
              Invalid env var name. Use letters, digits, and underscores only.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Value</label>
          <Input
            type="password"
            value={value}
            onChange={(e) => handleValuePaste(e.target.value)}
            placeholder={preset?.prefix ? `${preset.prefix}…` : "paste your secret"}
            className="bg-background/50 border-white/10 font-mono text-sm"
          />
          {autoDetectedFor && preset && value === autoDetectedFor && (
            <p className="text-[11px] text-primary flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Detected as {preset.label}
            </p>
          )}
          {prefixMismatch && (
            <p className="text-[11px] text-warning">
              Doesn't look like a {preset!.label} key (expected to start with{" "}
              <code>{preset!.prefix}</code>).
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(normalizedEnvVar, value)}
          disabled={!envValid || !value || saving}
          className="gradient-primary text-primary-foreground"
        >
          {saving ? "Saving…" : "Save secret"}
        </Button>
      </div>
    </div>
  );
};

export default SecretForm;
