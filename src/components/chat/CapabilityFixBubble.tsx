import { useEffect, useState } from "react";
import { Wrench, KeyRound, Puzzle, ShieldAlert, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import { useSettings } from "@/contexts/SettingsContext";
import type { ToolUnavailableHit } from "@/lib/toolUnavailable";
import { cn } from "@/lib/utils";

/**
 * REACTIVE capability fix bubble — replaces the previous generic
 * "Open Skills / Add key" warning. When the agent's reply trips the
 * `toolUnavailable` detector, this bubble:
 *
 *   1. Shows a checklist of what's wrong (permission / key / skill / extras).
 *   2. Surfaces the relevant capability id so the user can flip the
 *      policy to Always Allow / Always Deny right from chat.
 *   3. Provides one-click jumps to Permissions / Secrets / Skills.
 *
 * The capability id is inferred from the ToolUnavailableHit's `capability`
 * field (which is already mapped to the same ids the registry uses).
 */
const CapabilityFixBubble = ({ hit }: { hit: ToolUnavailableHit }) => {
  const { registry, policy, setPolicy, readinessFor } = useCapabilities();
  const { settings } = useSettings();
  // toolUnavailable.capability ids: "browser" → "webBrowser", "webSearch" → "webSearch"
  const idMap: Record<string, string> = {
    browser: "webBrowser",
    webSearch: "webSearch",
    imageGen: "imageGen",
    voice: "voice",
    email: "email",
    messaging: "messaging",
    memory: "memory",
    codeInterpreter: "script",
    filesystem: "fileWrite",
  };
  const capId = idMap[hit.capability] ?? hit.capability;
  const cap = registry[capId];
  const choice = policy[capId] ?? "ask";
  const readiness = capId in registry ? readinessFor(capId) : null;
  const internetSetting = settings.permissions?.internet;

  const checks = [
    {
      label: "Internet permission",
      ok: internetSetting !== "deny",
      detail:
        internetSetting === "deny"
          ? "Internet access is set to Deny in Permissions."
          : `Set to ${internetSetting === "allow" ? "Always allow" : "Ask"}`,
      action: internetSetting === "deny"
        ? { label: "Open Permissions", onClick: () => { window.location.hash = "#/settings"; } }
        : null,
    },
    {
      label: "Capability policy",
      ok: choice !== "deny",
      detail: choice === "deny" ? "You set this capability to Always deny." : `Set to ${choice}`,
      action: null,
    },
    {
      label: "Provider key",
      ok: !readiness?.missingSecret,
      detail: readiness?.missingSecret
        ? `Missing one of: ${hit.candidateSecrets.join(" / ")}`
        : "Found in your secrets store",
      action: readiness?.missingSecret && hit.candidateSecrets[0]
        ? {
            label: `Add ${hit.candidateSecrets[0]}`,
            onClick: () => { window.location.hash = `#/secrets?addKey=${hit.candidateSecrets[0]}`; },
          }
        : null,
    },
    {
      label: "Skill installed",
      ok: !readiness?.missingSkill,
      detail: readiness?.missingSkill
        ? `Need one of: ${hit.candidateSkills.join(", ") || "(none listed)"}`
        : "Skill found in agent",
      action: readiness?.missingSkill
        ? { label: "Open Skills", onClick: () => { window.location.hash = "#/skills"; } }
        : null,
    },
  ];

  if (hit.extrasPackage) {
    checks.push({
      label: "Python extras",
      ok: true, // we can't actually verify this client-side; show it as informational
      detail: `Some setups also need: pip install hermes-agent[${hit.extrasPackage}]`,
      action: null,
    });
  }

  return (
    <div className="mt-2 p-3 rounded-md border border-warning/40 bg-warning/10 text-xs space-y-2">
      <div className="flex items-start gap-2">
        <Wrench className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">
            {cap?.label ?? hit.label} isn't working
          </p>
          <p className="text-muted-foreground mt-0.5">{hit.hint}</p>
        </div>
      </div>

      <ul className="space-y-1 pl-1">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2">
            {c.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <span className={cn("font-medium", c.ok ? "text-foreground/80" : "text-foreground")}>
                {c.label}
              </span>
              <span className="text-muted-foreground"> — {c.detail}</span>
              {c.action && (
                <button
                  type="button"
                  onClick={c.action.onClick}
                  className="ml-2 text-primary hover:underline"
                >
                  {c.action.label} →
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {cap && (
        <div className="flex items-center gap-2 pt-1 border-t border-warning/20">
          <span className="text-[11px] text-muted-foreground">Next time:</span>
          {(["allow", "session", "deny"] as const).map((c) => (
            <Button
              key={c}
              size="sm"
              variant={choice === c ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setPolicy(capId, c)}
            >
              {c === "allow" ? "Always allow" : c === "session" ? "This session" : "Always deny"}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CapabilityFixBubble;
