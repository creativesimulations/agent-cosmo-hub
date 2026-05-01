import { Check, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IntentCardShell from './IntentCardShell';
import type { ConfirmIntent, IntentResponse } from '@/lib/agentIntents';

interface Props {
  intent: ConfirmIntent;
  onRespond: (response: IntentResponse) => void;
  responded?: boolean;
  previousResponse?: IntentResponse;
}

/** Plain yes/no with optional destructive styling. */
const ConfirmCard = ({ intent, onRespond, responded, previousResponse }: Props) => {
  const handle = (ok: boolean) => {
    if (responded) return;
    onRespond({ id: intent.id, ok, reason: ok ? undefined : 'declined' });
  };

  return (
    <IntentCardShell
      icon={<HelpCircle className="w-4 h-4" />}
      title={intent.title}
      description={intent.description}
      openUrl={intent.openUrl}
      tone={intent.destructive ? 'danger' : 'default'}
      locked={responded}
      footer={
        responded ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" />
            {previousResponse?.ok ? intent.confirmLabel || 'Confirmed' : intent.cancelLabel || 'Declined'}
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => handle(false)}>
              {intent.cancelLabel || 'Cancel'}
            </Button>
            <Button
              size="sm"
              onClick={() => handle(true)}
              className={
                intent.destructive
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'gradient-primary text-primary-foreground'
              }
            >
              {intent.confirmLabel || 'Confirm'}
            </Button>
          </>
        )
      }
    >
      {/* Body is whatever description provided in the shell — keep empty here. */}
      <span className="sr-only">Confirmation</span>
    </IntentCardShell>
  );
};

export default ConfirmCard;
