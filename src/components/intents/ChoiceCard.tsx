import { useState } from 'react';
import { Check, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import IntentCardShell from './IntentCardShell';
import type { ChoiceIntent, IntentResponse } from '@/lib/agentIntents';

interface Props {
  intent: ChoiceIntent;
  onRespond: (response: IntentResponse) => void;
  responded?: boolean;
  previousResponse?: IntentResponse;
}

const ChoiceCard = ({ intent, onRespond, responded, previousResponse }: Props) => {
  const [value, setValue] = useState<string>(intent.defaultValue || intent.options[0].value);
  const submit = () => {
    if (responded) return;
    onRespond({ id: intent.id, ok: true, values: { choice: value } });
  };
  const cancel = () => {
    if (responded) return;
    onRespond({ id: intent.id, ok: false, reason: 'cancelled' });
  };

  return (
    <IntentCardShell
      icon={<ListChecks className="w-4 h-4" />}
      title={intent.title}
      description={intent.description}
      openUrl={intent.openUrl}
      locked={responded}
      footer={
        responded ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" />
            {previousResponse?.ok
              ? `Picked: ${previousResponse?.values?.choice ?? ''}`
              : 'Cancelled'}
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} className="gradient-primary text-primary-foreground">
              Choose
            </Button>
          </>
        )
      }
    >
      <RadioGroup value={value} onValueChange={setValue} className="space-y-2">
        {intent.options.map((o) => (
          <Label
            key={o.value}
            htmlFor={`intent-${intent.id}-${o.value}`}
            className="flex items-start gap-3 p-2 rounded-lg border border-white/10 hover:bg-white/5 cursor-pointer"
          >
            <RadioGroupItem id={`intent-${intent.id}-${o.value}`} value={o.value} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm text-foreground">{o.label}</span>
              {o.description && (
                <span className="block text-[11px] text-muted-foreground leading-relaxed">
                  {o.description}
                </span>
              )}
            </span>
          </Label>
        ))}
      </RadioGroup>
    </IntentCardShell>
  );
};

export default ChoiceCard;
