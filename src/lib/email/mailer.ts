import { render, type EmailContext, type EmailKind, type TemplateDataMap } from './templates.ts';

/**
 * Typed mailer: send(kind, to, data). Transport-agnostic by design (the
 * Resend→Cloudflare Email Service switch was a transport swap; a fallback
 * would be another). Transactional identity — sends from
 * no-reply@mail.tunnex.io (subdomain senders are supported by Email Service
 * onboarding; the locked decision stands), replies land at sales@tunnex.io.
 *
 * Logging is structured JSON and never includes raw tokens or URLs — only
 * the kind, the recipient's domain, and the transport's message id.
 */

export const TRANSACTIONAL_FROM = 'Tunnex <no-reply@mail.tunnex.io>';
export const REPLY_TO = 'sales@tunnex.io';

export interface OutboundEmail {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: OutboundEmail): Promise<{ id: string }>;
}

/**
 * Production transport: the Workers EMAIL binding (Cloudflare Email Service,
 * public beta). No API key — the binding IS the credential, which keeps the
 * CI-only-credentials rule intact.
 */
export function bindingTransport(binding: SendEmail): EmailTransport {
  return {
    async send(message) {
      const response =
        (await (
          binding as unknown as {
            send(msg: Record<string, unknown>): Promise<{ messageId?: string }>;
          }
        ).send({
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: { 'Reply-To': message.replyTo },
        })) ?? {};
      return { id: response.messageId ?? 'unknown' };
    },
  };
}

/**
 * Dev transport: Workers have no filesystem, so "write-to-disk" is
 * approximated by dumping the full rendered email as structured console
 * output (wrangler dev prints it; pipe to a file for an on-disk copy).
 * Used automatically when the EMAIL binding is unavailable (local dev has
 * no Cloudflare credentials — remote bindings need auth).
 */
export function devTransport(): EmailTransport {
  let counter = 0;
  return {
    async send(message) {
      counter += 1;
      const id = `dev-${counter}`;
      console.log(JSON.stringify({ event: 'email.dev_transport', id, message }));
      return { id };
    },
  };
}

/** Picks the binding when present (deployed / remote), dev dump otherwise. */
export function transportFromEnv(env: { EMAIL?: SendEmail }): EmailTransport {
  return env.EMAIL ? bindingTransport(env.EMAIL) : devTransport();
}

export interface MailerDeps {
  transport: EmailTransport;
  /** Link/asset base for templates (flips to https://tunnex.io at launch). */
  baseUrl: string;
}

export interface SendResult {
  id: string;
}

export function createMailer(deps: MailerDeps) {
  const ctx: EmailContext = { baseUrl: deps.baseUrl };

  return {
    async send<K extends EmailKind>(
      kind: K,
      to: string,
      data: TemplateDataMap[K],
    ): Promise<SendResult> {
      const { subject, html, text } = render(kind, data, ctx);
      const toDomain = to.split('@').at(-1) ?? 'invalid';
      try {
        const { id } = await deps.transport.send({
          from: TRANSACTIONAL_FROM,
          replyTo: REPLY_TO,
          to,
          subject,
          html,
          text,
        });
        console.log(JSON.stringify({ event: 'email.sent', kind, toDomain, id }));
        return { id };
      } catch (error) {
        console.log(
          JSON.stringify({
            event: 'email.send_failed',
            kind,
            toDomain,
            error: error instanceof Error ? error.message : 'unknown',
          }),
        );
        throw new Error(`email send failed: ${kind}`);
      }
    },
  };
}

export type Mailer = ReturnType<typeof createMailer>;
