import { useState } from "react";
import { AlertCircle, Wrench, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ActionableErrorProps {
  title: string;
  summary: string;
  details?: string;
  onFix?: () => void | Promise<void>;
  fixing?: boolean;
  fixLabel?: string;
}

const ActionableError = ({
  title,
  summary,
  details,
  onFix,
  fixing = false,
  fixLabel = "Fix Automatically",
}: ActionableErrorProps) => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {onFix && (
          <Button size="sm" variant="destructive" onClick={() => void onFix()} disabled={fixing}>
            <Wrench className="w-3.5 h-3.5 mr-1.5" />
            {fixing ? "Fixing..." : fixLabel}
          </Button>
        )}
        {details && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowDetails((prev) => !prev)}
            className="border-white/10"
          >
            <ChevronDown className={`w-3.5 h-3.5 mr-1.5 transition-transform ${showDetails ? "rotate-180" : ""}`} />
            Show details
          </Button>
        )}
      </div>

      {showDetails && details && (
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-muted-foreground bg-background/40 rounded-md p-2 border border-white/5">
          {details}
        </pre>
      )}
    </div>
  );
};

export default ActionableError;

