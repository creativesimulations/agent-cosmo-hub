import { motion } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle2,
  Link2,
  Loader2,
  User,
  XCircle,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type IndexGuardPanelProps = {
  existingAgentName: string;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  renaming: boolean;
  resetting: boolean;
  resetOutput: string[];
  onBack: () => void;
  onConnect: () => void;
  onRename: () => void;
  onRequestReset: () => void;
};

export function IndexGuardPanel({
  existingAgentName,
  renameValue,
  onRenameValueChange,
  renaming,
  resetting,
  resetOutput,
  onBack,
  onConnect,
  onRename,
  onRequestReset,
}: IndexGuardPanelProps) {
  return (
    <motion.div
      key="guard"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      className="max-w-md w-full space-y-6"
    >
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Button>

      <GlassCard className="space-y-5">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success" />
            You already have an agent
          </h2>
          <p className="text-sm text-muted-foreground">
            An agent named <span className="text-primary font-semibold">{existingAgentName}</span> is already installed at{" "}
            <code className="text-foreground text-xs">~/.hermes</code>. Ronbot is built for a single agent — pick how you want to continue.
          </p>
        </div>

        <div className="space-y-3">
          <Button onClick={onConnect} className="w-full gradient-primary text-primary-foreground">
            <Link2 className="w-4 h-4 mr-2" /> Connect to {existingAgentName}
          </Button>

          <div className="glass-subtle rounded-lg p-3 space-y-2">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-primary" /> Rename this agent
            </label>
            <p className="text-xs text-muted-foreground">
              Updates the persona file and clears chat history so the new name takes effect on the next message. Keeps secrets, skills, and the venv.
            </p>
            <div className="flex gap-2">
              <Input
                value={renameValue}
                onChange={(e) => onRenameValueChange(e.target.value)}
                placeholder="New name"
                disabled={renaming}
                className="bg-background/50 border-white/10 text-sm"
              />
              <Button
                onClick={onRename}
                disabled={renaming || !renameValue.trim() || renameValue.trim() === existingAgentName}
                size="sm"
                variant="secondary"
              >
                {renaming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rename"}
              </Button>
            </div>
          </div>

          <Button
            onClick={onRequestReset}
            variant="ghost"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <XCircle className="w-4 h-4 mr-2" /> Reset & install fresh
          </Button>
        </div>

        {resetting && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Removing existing agent...
            </div>
            <div className="font-mono text-xs space-y-1 max-h-32 overflow-y-auto pr-1 glass-subtle rounded-lg p-2">
              {resetOutput.map((line, i) => (
                <p
                  key={i}
                  className={
                    line.startsWith("✓")
                      ? "text-success"
                      : line.startsWith("✗")
                        ? "text-destructive"
                        : "text-foreground/70"
                  }
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
