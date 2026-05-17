import { Wrench } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "@/hooks/useDoctorReport";

const ActionableIssuesCard = ({ report }: { report: DoctorReport }) => {
  const { actionableIssues, startupIssues, fixingStartup, handleFixStartupIssues } = report;
  return (
    <GlassCard className="p-4 space-y-3">
      <h2 className="text-sm font-semibold">Actionable issues</h2>
      {actionableIssues.length === 0 && startupIssues.length === 0 ? (
        <p className="text-xs text-muted-foreground">No obvious configuration issues detected.</p>
      ) : (
        <div className="space-y-3">
          {startupIssues.length > 0 && (
            <div className="space-y-2">
              {startupIssues.map((issue) => (
                <div key={issue.id} className="text-xs text-foreground rounded-md border border-border/60 bg-background/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{issue.title}</span>
                    <Badge variant={issue.severity === "error" ? "destructive" : "outline"} className="text-[10px]">
                      {issue.severity}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1">{issue.detail}</p>
                </div>
              ))}
              <Button onClick={handleFixStartupIssues} disabled={fixingStartup} variant="secondary" size="sm">
                <Wrench className={cn("w-3.5 h-3.5 mr-1.5", fixingStartup && "animate-spin")} />
                {fixingStartup ? "Fixing startup issues…" : "Fix startup issues"}
              </Button>
            </div>
          )}
          <ul className="space-y-2">
            {actionableIssues.map((issue) => (
              <li key={issue} className="text-xs text-foreground rounded-md border border-border/60 bg-background/30 px-3 py-2">
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
};

export default ActionableIssuesCard;
