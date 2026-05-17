// Hermes v0.13.0 sync — May 2026 (Ronbot)
import { Loader2 } from "lucide-react";
import type { SetupBlockingState } from "@/features/setup/types";

type Props = {
  blocking: SetupBlockingState;
};

export default function SetupBlockingOverlay({ blocking }: Props) {
  if (!blocking.active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="glass-strong rounded-xl px-8 py-6 flex flex-col items-center gap-3 max-w-sm mx-4 border border-white/10 shadow-2xl">
        <Loader2 className="w-8 h-8 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-foreground text-center">{blocking.message}</p>
      </div>
    </div>
  );
}
