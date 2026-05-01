import { Check, ExternalLink, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IntentCardShell from './IntentCardShell';
import type { OAuthOpenIntent, IntentResponse } from '@/lib/agentIntents';

interface Props {
  intent: OAuthOpenIntent;
  onRespond: (response: IntentResponse) => void;
  responded?: boolean;
  previousResponse?: IntentResponse;
}

const OAuthCard = ({ intent, onRespond, responded, previousResponse }: Props) => {
  const open = () => {
    // Electron + browser: shell.openExternal isn't directly available in the
    // renderer here, so we fall back to a plain anchor click — the Electron
    // main process intercepts new-window navigations and opens externally.
    window.open(intent.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <IntentCardShell
      icon={<Globe className="w-4 h-4" />}
      title={intent.title}
      description={intent.description}
      locked={responded}
      footer={
        responded ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" />
            {previousResponse?.ok ? 'Returned' : 'Cancelled'}
          </span>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRespond({ id: intent.id, ok: false, reason: 'cancelled' })}
            >
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={open}>
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              {intent.openLabel || 'Open in browser'}
            </Button>
            <Button
              size="sm"
              onClick={() => onRespond({ id: intent.id, ok: true })}
              className="gradient-primary text-primary-foreground"
            >
              {intent.doneLabel || "I'm back"}
            </Button>
          </>
        )
      }
    >
      <p className="text-xs text-muted-foreground break-all">{intent.url}</p>
    </IntentCardShell>
  );
};

export default OAuthCard;
