import { CheckCircle2 } from 'lucide-react';
import IntentCardShell from './IntentCardShell';
import type { DoneIntent } from '@/lib/agentIntents';

/**
 * Terminal "all-done" card. Purely informational — the agent emits this
 * to tell the renderer it can refresh capability/channel state. The host
 * (ChatContext) listens for these and triggers the appropriate refresh.
 */
const DoneCard = ({ intent }: { intent: DoneIntent }) => (
  <IntentCardShell
    icon={<CheckCircle2 className="w-4 h-4" />}
    title={intent.title}
    description={intent.message || intent.description}
    tone="success"
  >
    <span className="sr-only">Done</span>
  </IntentCardShell>
);

export default DoneCard;
