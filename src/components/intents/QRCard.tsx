import { Check, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IntentCardShell from './IntentCardShell';
import type { QRDisplayIntent, IntentResponse } from '@/lib/agentIntents';

interface Props {
  intent: QRDisplayIntent;
  onRespond: (response: IntentResponse) => void;
  responded?: boolean;
  previousResponse?: IntentResponse;
}

/**
 * QR display card. Accepts either a full `data:image/...;base64,` URL or
 * a raw base64 PNG string. Shows the optional pairing-code text as a
 * monospace fallback for users whose camera fails.
 */
const QRCard = ({ intent, onRespond, responded, previousResponse }: Props) => {
  const src = intent.qr.startsWith('data:')
    ? intent.qr
    : `data:image/png;base64,${intent.qr}`;

  return (
    <IntentCardShell
      icon={<QrCode className="w-4 h-4" />}
      title={intent.title}
      description={intent.description}
      openUrl={intent.openUrl}
      locked={responded}
      footer={
        responded ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" />
            {previousResponse?.ok ? 'Linked' : 'Cancelled'}
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
            <Button
              size="sm"
              onClick={() => onRespond({ id: intent.id, ok: true })}
              className="gradient-primary text-primary-foreground"
            >
              {intent.doneLabel || 'I scanned it'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="bg-white p-3 rounded-lg">
          <img
            src={src}
            alt="Pairing QR code"
            className="w-48 h-48 object-contain"
          />
        </div>
        {intent.pairingCode && (
          <p className="text-[11px] text-muted-foreground font-mono tracking-wider">
            {intent.pairingCode}
          </p>
        )}
      </div>
    </IntentCardShell>
  );
};

export default QRCard;
