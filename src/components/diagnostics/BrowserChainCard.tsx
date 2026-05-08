import { Globe, Wrench, CheckCircle2, XCircle, Activity } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "@/hooks/useDoctorReport";

const BrowserChainCard = ({ report }: { report: DoctorReport }) => {
  const { browserDiag, browserBusy, selfTest, selfTestBusy, handleRepairBrowser, handleBrowserSelfTest } = report;

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          Browser toolset chain
          <span className="text-[11px] font-normal text-muted-foreground">
            (CDP → config.yaml → toolset → permission)
          </span>
        </h2>
        <Button onClick={handleRepairBrowser} disabled={browserBusy} variant="ghost" size="sm">
          <Wrench className={cn("w-3 h-3 mr-1", browserBusy && "animate-pulse")} />
          Repair config
        </Button>
      </div>

      {!browserDiag ? (
        <p className="text-xs text-muted-foreground">Loading browser diagnostics…</p>
      ) : (
        <ul className="text-xs space-y-1.5">
          <li className="flex items-center gap-2">
            {browserDiag.cdpUrl
              ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
              : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
            <span className="font-mono">cdp_url:</span>
            <span className={cn("font-mono", browserDiag.cdpUrl ? "text-foreground" : "text-destructive")}>
              {browserDiag.cdpUrl ?? "not set — agent has no browser to drive"}
            </span>
          </li>
          {browserDiag.cdpUrl && (
            <li className="flex items-center gap-2">
              {browserDiag.cdpReachable
                ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <span className="font-mono">CDP reachable:</span>
              <span className={cn(browserDiag.cdpReachable ? "text-foreground" : "text-destructive")}>
                {browserDiag.cdpReachable
                  ? `yes${browserDiag.cdpVersion ? ` (${browserDiag.cdpVersion})` : ""}`
                  : "no — start Chrome from Skills → Browser, or open it on port 9222"}
              </span>
            </li>
          )}
          <li className="flex items-center gap-2">
            {browserDiag.browserEnabledInConfig
              ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
              : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
            <span className="font-mono">managed browser block present:</span>
            <span className={cn(browserDiag.browserEnabledInConfig ? "text-foreground" : "text-destructive")}>
              {browserDiag.browserEnabledInConfig ? "yes" : "missing — click Repair"}
            </span>
          </li>
          <li className="flex items-center gap-2">
            {browserDiag.hermesWebToolsetLoaded
              ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
              : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
            <span className="font-mono">agent toolset loaded:</span>
            <span className={cn(browserDiag.hermesWebToolsetLoaded ? "text-foreground" : "text-destructive")}>
              {browserDiag.hermesWebToolsetLoaded
                ? "yes (web, browser_*, terminal, file, vision, image_gen, tts… all registered)"
                : "no — agent has no tools loaded; click Repair config"}
            </span>
          </li>
          <li className="flex items-center gap-2">
            {browserDiag.internetPermission === "allow"
              ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
              : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
            <span className="font-mono">internet permission:</span>
            <span className={cn(browserDiag.internetPermission === "allow" ? "text-foreground" : "text-destructive")}>
              {browserDiag.internetPermission ?? "not synced"}
              {browserDiag.internetPermission && browserDiag.internetPermission !== "allow" &&
                " — set to 'allow' in Settings → Permissions and re-sync"}
            </span>
          </li>
        </ul>
      )}

      {browserDiag?.rawBrowserBlock && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Show raw browser block</summary>
          <pre className="mt-1 p-2 rounded bg-background/40 border border-white/5 font-mono whitespace-pre-wrap">
            {browserDiag.rawBrowserBlock}
            {browserDiag.rawToolsetsBlock ? "\n\n" + browserDiag.rawToolsetsBlock : ""}
          </pre>
        </details>
      )}

      <div className="pt-2 border-t border-white/5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-foreground">End-to-end browser self-test</p>
          <Button onClick={handleBrowserSelfTest} disabled={selfTestBusy} variant="outline" size="sm">
            <Activity className={cn("w-3 h-3 mr-1", selfTestBusy && "animate-pulse")} />
            {selfTestBusy ? "Testing…" : "Run self-test"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Opens a real CDP tab, navigates to example.com, and reports what the agent will actually be able to do.
        </p>
        {selfTest && (
          <ul className="text-xs space-y-1.5 mt-2">
            <li className="flex items-center gap-2">
              {selfTest.hermesCliToolsetLoaded
                ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <span>Browser tool registered (agent toolset)</span>
            </li>
            {selfTest.cdpUrl && (
              <li className="flex items-center gap-2">
                {selfTest.cdpReachable
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                <span>CDP reachable {selfTest.cdpVersion ? `(${selfTest.cdpVersion})` : ""}</span>
              </li>
            )}
            {selfTest.navigateOk !== null && (
              <li className="flex items-center gap-2">
                {selfTest.navigateOk
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                <span>
                  Real navigation: {selfTest.navigateOk
                    ? `landed on ${selfTest.navigateFinalUrl ?? "example.com"}`
                    : (selfTest.navigateError ?? "failed")}
                </span>
              </li>
            )}
            <li className="flex items-center gap-2">
              {selfTest.webSearchBackend
                ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-warning shrink-0" />}
              <span>
                Web-search backend: {selfTest.webSearchBackend
                  ? selfTest.webSearchBackend.toUpperCase()
                  : "none — Ron can read URLs but can't discover new ones"}
              </span>
            </li>
            {selfTest.doctorReportsBrowser !== null && (
              <li className="flex items-center gap-2">
                {selfTest.doctorReportsBrowser
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                <span>agent doctor reports browser tool</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </GlassCard>
  );
};

export default BrowserChainCard;
