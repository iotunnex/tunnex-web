import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMailer,
  devTransport,
  transportFromEnv,
  REPLY_TO,
  TRANSACTIONAL_FROM,
  type EmailTransport,
  type OutboundEmail,
} from './mailer.ts';

function fakeTransport(fail = false) {
  const sent: OutboundEmail[] = [];
  const transport: EmailTransport & { sent: OutboundEmail[] } = {
    sent,
    async send(message) {
      if (fail) throw new Error('binding rejected the message');
      sent.push(message);
      return { id: `msg_${sent.length}` };
    },
  };
  return transport;
}

describe('mailer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('sends with the transactional identity and reply-to', async () => {
    const transport = fakeTransport();
    const mailer = createMailer({ transport, baseUrl: 'https://example.test' });

    const result = await mailer.send('trial-approved', 'ada@acme.com', { domain: 'acme.com' });

    expect(result.id).toBe('msg_1');
    const message = transport.sent[0]!;
    expect(message.from).toBe(TRANSACTIONAL_FROM);
    expect(message.replyTo).toBe(REPLY_TO);
    expect(message.to).toBe('ada@acme.com');
    expect(message.html).toContain('acme.com');
    expect(message.text).toContain('acme.com');
  });

  it('never logs raw tokens or full recipient addresses', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ transport: fakeTransport(), baseUrl: 'https://example.test' });

    await mailer.send('trial-verify', 'ada@acme.com', {
      domain: 'acme.com',
      verifyUrl: 'https://example.test/trial/verify?token=SECRET_RAW_TOKEN',
    });

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('SECRET_RAW_TOKEN');
    expect(logged).not.toContain('ada@acme.com');
    expect(logged).toContain('"toDomain":"acme.com"');
    expect(logged).toContain('"kind":"trial-verify"');
  });

  it('throws and logs a structured failure when the transport errors', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({
      transport: fakeTransport(true),
      baseUrl: 'https://example.test',
    });

    await expect(
      mailer.send('trial-approved', 'ada@acme.com', { domain: 'acme.com' }),
    ).rejects.toThrow('email send failed');
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('email.send_failed');
  });

  it('transportFromEnv picks the binding when present, dev dump otherwise', async () => {
    const calls: unknown[] = [];
    const binding = {
      send: async (msg: unknown) => {
        calls.push(msg);
        return { messageId: 'cf_123' };
      },
    } as unknown as SendEmail;
    const viaBinding = transportFromEnv({ EMAIL: binding });
    const result = await viaBinding.send({
      from: TRANSACTIONAL_FROM,
      replyTo: REPLY_TO,
      to: 'a@b.co',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
    expect(result.id).toBe('cf_123');
    expect(calls[0]).toMatchObject({ headers: { 'Reply-To': REPLY_TO } });

    const dev = transportFromEnv({});
    expect((await dev.send(await sample())).id).toBe('dev-1');
  });

  it('dev transport dumps the full rendered email to structured logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = devTransport();
    await transport.send(await sample());
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('email.dev_transport');
    expect(logged).toContain('"subject":"s"');
  });
});

async function sample(): Promise<OutboundEmail> {
  return {
    from: TRANSACTIONAL_FROM,
    replyTo: REPLY_TO,
    to: 'a@b.co',
    subject: 's',
    html: '<p>h</p>',
    text: 't',
  };
}
