import { Activity } from "lucide-react";
import { useDoctorReport } from "@/hooks/useDoctorReport";
import ActionRowCard from "@/components/diagnostics/ActionRowCard";
import StatusCard from "@/components/diagnostics/StatusCard";
import ActionableIssuesCard from "@/components/diagnostics/ActionableIssuesCard";
import CredentialStoreCard from "@/components/diagnostics/CredentialStoreCard";
import EnvConfigCards from "@/components/diagnostics/EnvConfigCards";
import PermissionsCard from "@/components/diagnostics/PermissionsCard";
import BrowserChainCard from "@/components/diagnostics/BrowserChainCard";
import DebugTogglesCard from "@/components/diagnostics/DebugTogglesCard";
import CommandLogCard from "@/components/diagnostics/CommandLogCard";
import RecommendedPackages from "@/components/diagnostics/RecommendedPackages";

const Diagnostics = () => {
  const report = useDoctorReport();

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          App Diagnostics
        </h1>
        <p className="text-sm text-muted-foreground">
          View current state and fixable errors first. Technical command logs are available below when needed.{" "}
          <a href="#/logs" className="text-primary hover:underline">
            Looking for chat history or agent activity? See Agent Logs →
          </a>
        </p>
      </div>

      <ActionRowCard report={report} />
      <StatusCard report={report} />
      <ActionableIssuesCard report={report} />

      <details className="rounded-lg border border-border/60 bg-background/20 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Advanced diagnostics (for support)
        </summary>
        <div className="mt-3 space-y-4">
          <CredentialStoreCard report={report} />
          <EnvConfigCards report={report} />
          <PermissionsCard report={report} />
          <BrowserChainCard report={report} />
          <DebugTogglesCard />
          <CommandLogCard />
          <RecommendedPackages />
        </div>
      </details>
    </div>
  );
};

export default Diagnostics;
