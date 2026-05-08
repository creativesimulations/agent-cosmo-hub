import { useEffect, useState } from "react";
import { Wrench, RefreshCw, CheckCircle2, XCircle, Clock, Download } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { systemAPI } from "@/lib/systemAPI";

type PkgState = {
  id: string;
  label: string;
  hint: string;
  installed: boolean | null;
  version?: string;
  installing: boolean;
  message?: string;
};

const RecommendedPackages = () => {
  const [pkgs, setPkgs] = useState<PkgState[]>([
    { id: "ripgrep", label: "ripgrep (rg)", hint: "Fast in-repo search used by the agent's file tools.", installed: null, installing: false },
    { id: "ffmpeg",  label: "ffmpeg",       hint: "Audio/video processing for vision and TTS skills.",   installed: null, installing: false },
    { id: "curl",    label: "curl",         hint: "Used to download updates and run web-fetch tools.",   installed: null, installing: false },
  ]);

  useEffect(() => {
    void scanAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: string, patch: Partial<PkgState>) =>
    setPkgs((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const scanAll = async () => {
    const [rg, ff, c] = await Promise.all([
      systemAPI.checkRipgrep().catch(() => ({ installed: false })),
      systemAPI.checkFfmpeg().catch(() => ({ found: false })),
      systemAPI.checkCurl().catch(() => ({ installed: false })),
    ]);
    update("ripgrep", { installed: !!rg.installed, version: (rg as { version?: string }).version });
    update("ffmpeg",  { installed: !!(ff as { found?: boolean }).found, version: (ff as { version?: string }).version });
    update("curl",    { installed: !!c.installed,  version: (c as { version?: string }).version });
  };

  const install = async (id: string) => {
    update(id, { installing: true, message: undefined });
    try {
      const r =
        id === "ripgrep" ? await systemAPI.installRipgrep() :
        id === "ffmpeg"  ? await systemAPI.installFfmpeg() :
                            await systemAPI.installCurl();
      if (r?.success) {
        update(id, { installing: false, installed: true, message: "Installed" });
        await scanAll();
      } else {
        update(id, { installing: false, message: (r?.stderr || "Install failed").trim().slice(0, 240) });
      }
    } catch (e) {
      update(id, { installing: false, message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          Recommended packages
        </h2>
        <Button onClick={scanAll} variant="ghost" size="sm">
          <RefreshCw className="w-3 h-3 mr-1" /> Re-scan
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Optional tools that improve the agent's capabilities. Install anytime — none of these block the agent from running.
      </p>
      <div className="space-y-2">
        {pkgs.map((p) => (
          <div key={p.id} className="rounded-lg border border-white/5 bg-background/40 p-3 flex items-start gap-3">
            <div className="mt-0.5">
              {p.installed === null ? (
                <Clock className="w-4 h-4 text-muted-foreground" />
              ) : p.installed ? (
                <CheckCircle2 className="w-4 h-4 text-success" />
              ) : (
                <XCircle className="w-4 h-4 text-warning" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{p.label}</span>
                {p.version && <span className="text-[10px] font-mono text-accent">{p.version}</span>}
              </div>
              <p className="text-[11px] text-muted-foreground">{p.hint}</p>
              {p.message && (
                <p className="text-[11px] text-warning mt-1 font-mono whitespace-pre-wrap break-words">{p.message}</p>
              )}
            </div>
            {p.installed === false && (
              <Button size="sm" variant="ghost" disabled={p.installing} onClick={() => install(p.id)} className="shrink-0">
                {p.installing ? (
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Download className="w-3 h-3 mr-1" />
                )}
                {p.installing ? "Installing…" : "Install"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
};

export default RecommendedPackages;
