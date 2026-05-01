/**
 * Top-level intent renderer.
 *
 * Given an `AgentIntent`, dispatches to the right card. The host (the chat
 * message bubble) supplies a single `onRespond` callback that receives the
 * user's `IntentResponse` — the renderer doesn't know about the chat
 * transport, only about the protocol.
 *
 * The `responded` prop lets the host show a finished/locked card after the
 * user has already submitted (e.g. when scrolling back through history).
 */

import { useMemo } from 'react';
import type { AgentIntent, IntentResponse } from '@/lib/agentIntents';
import CredentialRequestCard from './CredentialRequestCard';
import ConfirmCard from './ConfirmCard';
import ChoiceCard from './ChoiceCard';
import QRCard from './QRCard';
import OAuthCard from './OAuthCard';
import FilePickCard from './FilePickCard';
import ProgressCard from './ProgressCard';
import DoneCard from './DoneCard';
import PairingCard from './PairingCard';

export interface IntentCardProps {
  intent: AgentIntent;
  /** Called once, when the user submits (or cancels) the card. */
  onRespond: (response: IntentResponse) => void;
  /** When true, the card is locked (already answered, replayed history). */
  responded?: boolean;
  /** Pre-existing response, used to render a finished state. */
  previousResponse?: IntentResponse;
}

const IntentCard = ({ intent, onRespond, responded, previousResponse }: IntentCardProps) => {
  // Memoize a no-op so cards have a stable handler reference when locked.
  const respond = useMemo(
    () => (responded ? () => undefined : onRespond),
    [responded, onRespond],
  );

  switch (intent.type) {
    case 'credential_request':
      return (
        <CredentialRequestCard
          intent={intent}
          onRespond={respond}
          responded={responded}
          previousResponse={previousResponse}
        />
      );
    case 'confirm':
      return (
        <ConfirmCard intent={intent} onRespond={respond} responded={responded} previousResponse={previousResponse} />
      );
    case 'choice':
      return (
        <ChoiceCard intent={intent} onRespond={respond} responded={responded} previousResponse={previousResponse} />
      );
    case 'qr_display':
      return (
        <QRCard intent={intent} onRespond={respond} responded={responded} previousResponse={previousResponse} />
      );
    case 'oauth_open':
      return (
        <OAuthCard intent={intent} onRespond={respond} responded={responded} previousResponse={previousResponse} />
      );
    case 'file_pick':
      return (
        <FilePickCard intent={intent} onRespond={respond} responded={responded} previousResponse={previousResponse} />
      );
    case 'progress':
      return <ProgressCard intent={intent} />;
    case 'done':
      return <DoneCard intent={intent} />;
    case 'pairing_approve':
      return (
        <PairingCard intent={intent} onRespond={respond} responded={responded} previousResponse={previousResponse} />
      );
    default:
      return null;
  }
};

export default IntentCard;
