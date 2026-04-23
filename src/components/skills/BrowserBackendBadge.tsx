import { useEffect, useState } from "react";
import { Globe, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { secretsStore, systemAPI } from "@/lib/systemAPI";
import { getActiveBrowserBackend } from "@/lib/browserBackends";
import { useSettings } from "@/contexts/SettingsContext";

interface BrowserBackendBadgeProps {
  /** Bumps when the wizard saves something so we re-read state. */
  refreshKey?: number;
  onSwitch?: () => void;
}

/**
 * Inline pill that shows which browser backend Hermes is currently using:
 *   "Active: Browserbase" / "Camofox @ localhost:9377" / "Local Chrome (manual)"
 *   / "Default (no anti-bot)".
 */
const BrowserBackendBadge = ({ refreshKey, onSwitch }: BrowserBackendBadgeProps) => {
  const { settings } = useSettings();
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [camofoxUrl, setCamofoxUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await secretsStore.list();
      if (cancelled) return;
      setKeys(new Set(r.keys || []));
      if ((r.keys || []).includes("CAMOFOX_URL")) {
        const v = await systemAPI.secrets.get("CAMOFOX_URL");
        if (!cancelled) setCamofoxUrl(v);
      } else {
        setCamofoxUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // "Local Chrome (manual)" is signalled by the user explicitly setting
  // webBrowser policy to "allow" via the wizard.
  const localChromeManual = settings.capabilityPolicy?.webBrowser === "allow"
    && !["BROWSERBASE_API_KEY", "BROWSER_USE_API_KEY", "CAMOFOX_URL", "FIRECRAWL_API_KEY"]
      .some((k) => keys.has(k));

  const { backend, label } = getActiveBrowserBackend(keys, {
    camofoxUrl,
    localChromeManual,
  });

  const tone = backend
    ? "border-success/30 bg-success/10 text-success"
    : "border-warning/30 bg-warning/10 text-warning";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant="outline" className={tone}>
        <Globe className="w-3 h-3 mr-1" />
        {label}
      </Badge>
      {onSwitch && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onSwitch}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          {backend ? "Switch backend" : "Set up browser"}
        </Button>
      )}
    </div>
  );
};

export default BrowserBackendBadge;
