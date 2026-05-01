import { useMemo, useState } from 'react';
import { Loader2, KeyRound, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import IntentCardShell from './IntentCardShell';
import {
  validateFieldValue,
  type CredentialRequestIntent,
  type IntentResponse,
} from '@/lib/agentIntents';
import { secretsStore } from '@/lib/systemAPI';
import { systemAPI } from '@/lib/systemAPI';

interface Props {
  intent: CredentialRequestIntent;
  onRespond: (response: IntentResponse) => void;
  responded?: boolean;
  previousResponse?: IntentResponse;
}

/**
 * Credential card. Validates each field with its `validate` regex before
 * enabling Submit; on submit, writes every value into the OS-keychain
 * `secretsStore` and (unless the intent opts out) calls `materializeEnv()`
 * so the running gateway picks them up — then posts a redacted response.
 */
const CredentialRequestCard = ({ intent, onRespond, responded, previousResponse }: Props) => {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(intent.fields.map((f) => [f.key, f.defaultValue ?? ''])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const f of intent.fields) out[f.key] = validateFieldValue(f, values[f.key] ?? '');
    return out;
  }, [intent.fields, values]);
  const allValid = intent.fields.every((f) => !fieldErrors[f.key]);

  const handleSubmit = async () => {
    if (!allValid || responded) return;
    setSubmitting(true);
    setError(null);
    try {
      // Persist every value to the keychain-backed store.
      for (const [key, raw] of Object.entries(values)) {
        const v = raw.trim();
        if (!v) continue;
        const ok = await secretsStore.set(key, v);
        if (!ok) throw new Error(`Failed to store ${key}`);
      }
      // Materialize into ~/.hermes/.env unless explicitly disabled.
      if (intent.materialize !== false) {
        await systemAPI.materializeEnv?.().catch(() => undefined);
      }
      onRespond({
        id: intent.id,
        ok: true,
        // We send the actual values back to the agent so it can use them
        // (e.g. token-validate API call). Renderer's chat bubble shows a
        // redacted summary so secrets never appear in chat history.
        values: Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, v.trim()]),
        ),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (responded) return;
    onRespond({ id: intent.id, ok: false, reason: 'cancelled' });
  };

  return (
    <IntentCardShell
      icon={<KeyRound className="w-4 h-4" />}
      title={intent.title}
      description={intent.description}
      openUrl={intent.openUrl}
      locked={responded}
      footer={
        responded ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" />
            {previousResponse?.ok ? 'Submitted' : 'Cancelled'}
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSubmit()}
              disabled={!allValid || submitting}
              className="gradient-primary text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…
                </>
              ) : (
                'Submit'
              )}
            </Button>
          </>
        )
      }
    >
      {intent.fields.map((f) => {
        const err = fieldErrors[f.key];
        const showErr = err && (values[f.key] ?? '').length > 0;
        return (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`intent-${intent.id}-${f.key}`} className="text-xs text-foreground">
              {f.label}
              {f.optional && <span className="text-muted-foreground"> (optional)</span>}
            </Label>
            <Input
              id={`intent-${intent.id}-${f.key}`}
              type={f.secret ? 'password' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.hint}
              disabled={submitting || responded}
              className="h-9 text-sm"
              autoComplete={f.secret ? 'new-password' : 'off'}
            />
            {f.hint && !showErr && (
              <p className="text-[11px] text-muted-foreground">{f.hint}</p>
            )}
            {showErr && <p className="text-[11px] text-destructive">{err}</p>}
          </div>
        );
      })}
      {error && (
        <p className="text-xs text-destructive border border-destructive/30 rounded-md px-2 py-1.5">
          {error}
        </p>
      )}
    </IntentCardShell>
  );
};

export default CredentialRequestCard;
