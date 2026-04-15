import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Download, CheckCircle2, GitBranch, Clock, ArrowUpRight, Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Version {
  version: string;
  date: string;
  changes: string[];
  current?: boolean;
}

const versions: Version[] = [
  {
    version: "0.2.0",
    date: "2024-01-20",
    changes: [
      "New skill: advanced_web_search with multi-source aggregation",
      "Improved sub-agent task delegation with priority queues",
      "Support for Claude 3.5 Sonnet as auxiliary model",
      "Bug fix: memory leak in long-running sub-agents",
    ],
  },
  {
    version: "0.1.1",
    date: "2024-01-15",
    changes: [
      "Hot fix: Gateway connection timeout increased",
      "Improved error handling for provider API failures",
    ],
    current: true,
  },
  {
    version: "0.1.0",
    date: "2024-01-10",
    changes: [
      "Initial release of Ronbot Agent",
      "Core skills: web_search, code_execution, file_management",
      "Gateway support: REST API, Telegram, Discord",
    ],
  },
];

const UpdateManager = () => {
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [hasUpdate, setHasUpdate] = useState(true);

  const checkForUpdates = async () => {
    setChecking(true);
    await new Promise((r) => setTimeout(r, 2000));
    setChecking(false);
    setHasUpdate(true);
  };

  const performUpdate = async () => {
    setUpdating(true);
    setUpdateProgress(0);
    const steps = [
      { progress: 15, delay: 800 },
      { progress: 35, delay: 1200 },
      { progress: 60, delay: 1500 },
      { progress: 85, delay: 1000 },
      { progress: 100, delay: 800 },
    ];
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, step.delay));
      setUpdateProgress(step.progress);
    }
    setUpdating(false);
    setHasUpdate(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-primary" />
            Update Manager
          </h1>
          <p className="text-sm text-muted-foreground">Keep your agent up to date</p>
        </div>
        <Button
          size="sm"
          onClick={checkForUpdates}
          disabled={checking}
          className="gradient-primary text-primary-foreground"
        >
          {checking ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Check for Updates
        </Button>
      </div>

      {hasUpdate && !updating && (
        <GlassCard className="border-primary/20 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">Update Available: v0.2.0</h3>
              <p className="text-sm text-muted-foreground">Released January 20, 2024</p>
            </div>
            <Button onClick={performUpdate} className="gradient-primary text-primary-foreground">
              <Download className="w-4 h-4 mr-1" /> Update Now
            </Button>
          </div>
          <div className="glass-subtle rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="text-foreground/80 font-medium mb-2">This will run:</p>
            <p className="font-mono">$ cd ronbot-agent && git pull origin main</p>
            <p className="font-mono">$ pip install -e . --upgrade</p>
            <p className="font-mono">$ agent restart</p>
          </div>
        </GlassCard>
      )}

      {updating && (
        <GlassCard className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Updating to v0.2.0...</h3>
          <Progress value={updateProgress} className="h-2" />
          <div className="font-mono text-xs text-muted-foreground space-y-1">
            {updateProgress >= 15 && <p className="text-success">✓ Pulling latest changes...</p>}
            {updateProgress >= 35 && <p className="text-success">✓ Installing dependencies...</p>}
            {updateProgress >= 60 && <p className="text-success">✓ Running migrations...</p>}
            {updateProgress >= 85 && <p className="text-success">✓ Restarting agent...</p>}
            {updateProgress >= 100 && <p className="text-success font-bold">✓ Update complete!</p>}
          </div>
        </GlassCard>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-accent" /> Version History
        </h3>
        {versions.map((v, i) => (
          <motion.div key={v.version} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <GlassCard variant={v.current ? "default" : "subtle"} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">v{v.version}</span>
                  {v.current && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                      Current
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {v.date}
                </span>
              </div>
              <ul className="space-y-1">
                {v.changes.map((change, j) => (
                  <li key={j} className="text-xs text-muted-foreground flex items-start gap-2">
                    <ArrowUpRight className="w-3 h-3 mt-0.5 text-accent shrink-0" />
                    {change}
                  </li>
                ))}
              </ul>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default UpdateManager;
