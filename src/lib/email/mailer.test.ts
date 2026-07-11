import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { createMailer, REPLY_TO, TRANSACTIONAL_FROM } from './mailer.ts';

describe('mailer', () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('sends with the transactional identity and reply-to', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
    const mailer = createMailer({ apiKey: 'test', baseUrl: 'https://example.test' });

    const result = await mailer.send('trial-approved', 'ada@acme.com', { domain: 'acme.com' });

    expect(result.id).toBe('msg_123');
    const payload = sendMock.mock.calls[0]![0];
    expect(payload.from).toBe(TRANSACTIONAL_FROM);
    expect(payload.replyTo).toBe(REPLY_TO);
    expect(payload.to).toBe('ada@acme.com');
    expect(payload.html).toContain('acme.com');
    expect(payload.text).toContain('acme.com');
  });

  it('never logs raw tokens or full recipient addresses', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_456' }, error: null });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ apiKey: 'test', baseUrl: 'https://example.test' });

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

  it('throws and logs a structured failure when resend errors', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ apiKey: 'test', baseUrl: 'https://example.test' });

    await expect(
      mailer.send('trial-approved', 'ada@acme.com', { domain: 'acme.com' }),
    ).rejects.toThrow('email send failed');
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('email.send_failed');
  });
});
