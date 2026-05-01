import { useState } from 'react';
import { Check, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IntentCardShell from './IntentCardShell';
import type { FilePickIntent, IntentResponse } from '@/lib/agentIntents';
import { systemAPI } from '@/lib/systemAPI';

interface Props {
  intent: FilePickIntent;
  onRespond: (response: IntentResponse) => void;
  responded?: boolean;
  previousResponse?: IntentResponse;
}

/**
 * File / folder picker. The main-process IPC currently exposes
 * `selectFolder` — for `pickKind === 'file'` we still go through that path
 * but the agent prompt template is responsible for explaining the
 * limitation to the user. This keeps the renderer dependency surface
 * minimal until we add a `selectFile` IPC.
 */
const FilePickCard = ({ intent, onRespond, responded, previousResponse }: Props) => {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    setBusy(true);
    try {
      const r = await systemAPI.selectFolder?.();
      if (r && (r as { canceled?: boolean }).canceled === false) {
        const filePaths = (r as { filePaths?: string[] }).filePaths;
        if (filePaths && filePaths.length > 0) setPath(filePaths[0]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <IntentCardShell
      icon={<FolderOpen className="w-4 h-4" />}
      title={intent.title}
      description={intent.description}
      locked={responded}
      footer={
        responded ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="w-3.5 h-3.5" />
            {previousResponse?.ok ? `Picked: ${previousResponse.path ?? ''}` : 'Cancelled'}
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
            <Button variant="secondary" size="sm" onClick={() => void pick()} disabled={busy}>
              <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
              {path ? 'Change' : `Pick ${intent.pickKind === 'file' ? 'file' : 'folder'}`}
            </Button>
            <Button
              size="sm"
              onClick={() => onRespond({ id: intent.id, ok: true, path: path || '' })}
              disabled={!path}
              className="gradient-primary text-primary-foreground"
            >
              Send
            </Button>
          </>
        )
      }
    >
      {path ? (
        <p className="text-xs text-foreground font-mono break-all">{path}</p>
      ) : (
        <p className="text-xs text-muted-foreground">No selection yet.</p>
      )}
    </IntentCardShell>
  );
};

export default FilePickCard;
