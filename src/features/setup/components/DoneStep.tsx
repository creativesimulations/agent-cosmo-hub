import { Link } from "react-router-dom";
import { CheckCircle2, KeyRound, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import GlassCard from "@/components/ui/GlassCard";

type Props = {
  onOpenHome: () => void;
};

export function DoneStep({ onOpenHome }: Props) {
  return (
    <GlassCard className="space-y-6 text-center">
      <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">You&apos;re connected</h2>
        <p className="text-sm text-muted-foreground">
          Open Agent Chat to talk to Hermes. Add API keys and pick a model when you&apos;re ready.
        </p>
      </div>
      <Button className="w-full gradient-primary text-primary-foreground" onClick={onOpenHome}>
        Open Agent Chat
      </Button>
      <div className="flex flex-col gap-2 text-sm">
        <Link to="/secrets" className="text-primary hover:underline inline-flex items-center justify-center gap-1">
          <KeyRound className="w-4 h-4" /> Add API keys
        </Link>
        <Link to="/models" className="text-primary hover:underline inline-flex items-center justify-center gap-1">
          <Cpu className="w-4 h-4" /> Choose model
        </Link>
      </div>
    </GlassCard>
  );
}
