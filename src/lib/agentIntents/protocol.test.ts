import { describe, it, expect } from 'vitest';
import {
  validateIntent,
  validateFieldValue,
  splitIntentsFromText,
  IntentStreamParser,
  formatIntentResponse,
  type CredentialRequestIntent,
  type IntentResponse,
} from './index';

describe('validateIntent', () => {
  it('accepts a well-formed credential_request', () => {
    const i = validateIntent({
      id: 'i1',
      type: 'credential_request',
      title: 'Slack tokens',
      fields: [{ key: 'SLACK_BOT_TOKEN', label: 'Bot token', secret: true }],
    });
    expect(i.type).toBe('credential_request');
  });

  it('rejects credential_request with no fields', () => {
    expect(() =>
      validateIntent({ id: 'i1', type: 'credential_request', title: 't', fields: [] }),
    ).toThrow();
  });

  it('rejects unknown intent types', () => {
    expect(() =>
      validateIntent({ id: 'i1', type: 'mystery', title: 't' }),
    ).toThrow(/unknown type/);
  });

  it('rejects missing id/title', () => {
    expect(() => validateIntent({ type: 'confirm', title: 't' })).toThrow();
    expect(() => validateIntent({ id: 'i1', type: 'confirm' })).toThrow();
  });

  it('accepts choice with options', () => {
    const i = validateIntent({
      id: 'c1',
      type: 'choice',
      title: 'Pick mode',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    });
    expect(i.type).toBe('choice');
  });
});

describe('validateFieldValue', () => {
  const f: CredentialRequestIntent['fields'][0] = {
    key: 'SLACK_BOT_TOKEN',
    label: 'Bot token',
    validate: '^xoxb-',
  };
  it('returns null for a valid value', () => {
    expect(validateFieldValue(f, 'xoxb-12345')).toBeNull();
  });
  it('returns an error for a non-matching value', () => {
    expect(validateFieldValue(f, 'wrong')).toMatch(/format/);
  });
  it('returns an error for empty required values', () => {
    expect(validateFieldValue(f, '   ')).toMatch(/required/);
  });
  it('returns null for empty optional values', () => {
    expect(validateFieldValue({ ...f, optional: true }, '')).toBeNull();
  });
});

describe('splitIntentsFromText', () => {
  it('extracts a single intent and strips the fence', () => {
    const input = [
      'Setting up Slack now…',
      '',
      '```ronbot-intent',
      JSON.stringify({
        id: 'i1',
        type: 'credential_request',
        title: 'Slack tokens',
        fields: [{ key: 'SLACK_BOT_TOKEN', label: 'Bot token' }],
      }),
      '```',
      '',
      "I'll wait.",
    ].join('\n');
    const r = splitIntentsFromText(input);
    expect(r.intents).toHaveLength(1);
    expect(r.intents[0].id).toBe('i1');
    expect(r.text).not.toMatch(/ronbot-intent/);
    expect(r.text).toMatch(/Setting up Slack/);
    expect(r.text).toMatch(/I'll wait/);
    expect(r.errors).toHaveLength(0);
  });

  it('handles multiple intents in one buffer', () => {
    const input = [
      '```ronbot-intent',
      '{"id":"a","type":"confirm","title":"OK?"}',
      '```',
      'middle',
      '```ronbot-intent',
      '{"id":"b","type":"confirm","title":"Again?"}',
      '```',
    ].join('\n');
    const r = splitIntentsFromText(input);
    expect(r.intents.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.text).toContain('middle');
  });

  it('records errors for malformed JSON without crashing', () => {
    const input = '```ronbot-intent\n{not valid json}\n```\nafter';
    const r = splitIntentsFromText(input);
    expect(r.intents).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.text).toContain('after');
  });

  it('leaves an unclosed fence as plain text', () => {
    const input = 'before\n```ronbot-intent\n{"id":"x"';
    const r = splitIntentsFromText(input);
    expect(r.text).toContain('before');
    expect(r.text).toContain('ronbot-intent');
  });
});

describe('IntentStreamParser', () => {
  it('emits visible text immediately and completes intent across chunks', () => {
    const parser = new IntentStreamParser();
    let seen = '';
    const intents: string[] = [];
    const push = (s: string) => {
      const r = parser.push(s);
      seen += r.textDelta;
      intents.push(...r.intents.map((i) => i.id));
    };
    push('Hello user. ');
    push('Here is a request:\n```ronbot-intent\n');
    push('{"id":"streamed","type":"confirm","title":"Yes?"}');
    push('\n```\nThanks.');
    seen += parser.end().textDelta;
    expect(intents).toEqual(['streamed']);
    expect(seen).toMatch(/Hello user/);
    expect(seen).toMatch(/Thanks\./);
    expect(seen).not.toMatch(/ronbot-intent/);
  });

  it('does not emit text inside an open fence prematurely', () => {
    const parser = new IntentStreamParser();
    const r1 = parser.push('text\n```ronbot-intent\n{"partial":');
    expect(r1.textDelta).toBe('text\n');
    expect(r1.intents).toHaveLength(0);
    // Close the fence with a valid intent so we don't leave a malformed payload.
    const r2 = parser.push('null}\n');
    expect(r2.intents).toHaveLength(0);
    const r3 = parser.push('```\nafter');
    // Malformed payload → goes into errors, but trailing text still flushes
    // (modulo the small look-ahead tail).
    const tail = parser.end().textDelta;
    const totalAfter = r3.textDelta + tail;
    expect(totalAfter).toContain('after');
    expect(parser.errors.length).toBeGreaterThan(0);
  });
});

describe('formatIntentResponse', () => {
  it('redacts secret-looking keys in the summary', () => {
    const intent: CredentialRequestIntent = {
      id: 'i',
      type: 'credential_request',
      title: 'Slack',
      fields: [
        { key: 'SLACK_BOT_TOKEN', label: 'Token', secret: true },
        { key: 'SLACK_ALLOWED_USERS', label: 'Users' },
      ],
    };
    const res: IntentResponse = {
      id: 'i',
      ok: true,
      values: { SLACK_BOT_TOKEN: 'xoxb-shh', SLACK_ALLOWED_USERS: 'U1,U2' },
    };
    const out = formatIntentResponse(res, intent);
    expect(out.summary).toContain('••••');
    expect(out.summary).not.toContain('xoxb-shh');
    expect(out.summary).toContain('U1,U2');
    expect(out.prompt).toContain('ronbot-intent-response');
    expect(out.prompt).toContain('xoxb-shh'); // raw values DO go to the agent
  });

  it('summarizes a cancelled response', () => {
    const out = formatIntentResponse({ id: 'i', ok: false, reason: 'expired' });
    expect(out.summary).toMatch(/Cancelled.*expired/);
  });
});
