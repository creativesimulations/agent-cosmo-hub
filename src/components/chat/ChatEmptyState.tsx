import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { useCapabilities } from "@/contexts/CapabilitiesContext";

interface ChatEmptyStateProps {
  onPick: (prompt: string) => void;
}

const ChatEmptyState = ({ onPick }: ChatEmptyStateProps) => {
  const { discovered } = useCapabilities();

  const { examples, shortcuts } = useMemo(() => {
    const all = Object.values(discovered);
    const ex: string[] = [];
    for (const c of all) {
      for (const p of c.examplePrompts ?? []) {
        if (ex.length < 6 && !ex.includes(p)) ex.push(p);
      }
    }
    const sc = all.filter((c) => c.requiresSetup).slice(0, 6);
    return { examples: ex, shortcuts: sc };
  }, [discovered]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col items-center justify-center px-4 py-8"
    >
      <div className="max-w-2xl w-full space-y-6 text-center">
        <div className="space-y-2">
          <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Say hi to your agent</h2>
          <p className="text-sm text-muted-foreground">
            Ask anything in plain language — your agent can install new skills and connect to the apps you use.
          </p>
        </div>

        {examples.length > 0 && (
          <div className="space-y-2 text-left">
            <p className="text-xs uppercase tracking-wide text-muted-foreground/70">Try one of these</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {examples.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPick(p)}
                  className="text-xs px-3 py-1.5 rounded-full glass-subtle border border-white/10 text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {shortcuts.length > 0 && (
          <div className="space-y-2 text-left">
            <p className="text-xs uppercase tracking-wide text-muted-foreground/70">Or set something up</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {shortcuts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c.setupPrompt)}
                  className="text-xs px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-foreground hover:bg-primary/20 transition-colors"
                >
                  Set up {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default ChatEmptyState;
