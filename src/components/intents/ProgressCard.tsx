import { Loader2 } from 'lucide-react';
import IntentCardShell from './IntentCardShell';
import type { ProgressIntent } from '@/lib/agentIntents';

const ProgressCard = ({ intent }: { intent: ProgressIntent }) => {
  const pct = typeof intent.percent === 'number' ? Math.max(0, Math.min(100, intent.percent)) : null;
  return (
    <IntentCardShell
      icon={<Loader2 className="w-4 h-4 animate-spin" />}
      title={intent.title}
      description={intent.description}
    >
      <div className="space-y-2">
        {intent.status && <p className="text-xs text-muted-foreground">{intent.status}</p>}
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full gradient-primary transition-all duration-500"
            style={pct !== null ? { width: `${pct}%` } : { width: '40%', animation: 'pulse 2s ease-in-out infinite' }}
          />
        </div>
        {pct !== null && (
          <p className="text-[11px] text-muted-foreground text-right">{pct}%</p>
        )}
      </div>
    </IntentCardShell>
  );
};

export default ProgressCard;
