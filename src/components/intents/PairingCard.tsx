import { Check, KeyRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IntentCardShell from './IntentCardShell';
import type { PairingApproveIntent, IntentResponse } from '@/lib/agentIntents';

interface Props {
  intent: PairingApproveIntent;
  onRespond: (response: IntentResponse) => void;
  responded?: boolean;
  previousResponse?: IntentResponse;
}

/**
 * Pairing-code approval card. Renders a one-time code the user reads off
 * another device (Matrix session verify, BlueBubbles iMessage pairing,
 * Signal device link, …) and lets them approve or reject in one click.
 *
 * No scanner, no clipboard — just confirm "yes that's me". The agent owns
 * the rest of the flow over the intent protocol.
 */
const PairingCard = ({ intent, onRespond, responded, previousResponse }: Props) => {
  const handle = (ok: boolean) => {
    if (responded) return;
    onRespond({ id: intent.id, ok, reason: ok ? undefined : 'rejected' });
  };

  return (
    <IntentCardShell
      icon={<KeyRound className="w-4 h-4" />}
      title={intent.title}
      description={intent.description ?? intent.instructions}
      openUrl={intent.openUrl}
      locked={responded}
      footer={
        responded ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" />
            {previousResponse?.ok ? 'Approved' : 'Rejected'}
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => handle(false)}>
              <X className="w-3.5 h-3.5 mr-1.5" />
              {intent.rejectLabel || 'Reject'}
            </Button>
            <Button
              size="sm"
              onClick={() => handle(true)}
              className="gradient-primary text-primary-foreground"
            >
              <Check className="w-3.5 h-3.5 mr-1.5" />
              {intent.approveLabel || 'Approve'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col items-center gap-2 py-2">
        {intent.platform && (
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {intent.platform}
          </p>
        )}
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-5 py-3">
          <p className="text-2xl font-mono font-semibold tracking-[0.2em] text-foreground text-center select-all">
            {intent.pairingCode}
          </p>
        </div>
        {intent.instructions && intent.description && (
          <p className="text-[11px] text-muted-foreground text-center max-w-sm">
            {intent.instructions}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground/70 text-center">
          Make sure this code matches the one on your other device before approving.
        </p>
      </div>
    </IntentCardShell>
  );
};

export default PairingCard;
