import { Resend } from 'resend';
import { render, type EmailContext, type EmailKind, type TemplateDataMap } from './templates.ts';

/**
 * Typed mailer: send(kind, to, data). Transactional identity — sends from
 * no-reply@mail.tunnex.io (dedicated subdomain protects the root domain's
 * reputation), replies land at sales@tunnex.io. Marketing sends can grow a
 * second identity here later without touching callers.
 *
 * Logging is structured JSON and never includes raw tokens or URLs — only
 * the kind, the recipient's domain, and Resend's message id.
 */

export const TRANSACTIONAL_FROM = 'Tunnex <no-reply@mail.tunnex.io>';
export const REPLY_TO = 'sales@tunnex.io';

export interface MailerDeps {
  apiKey: string;
  /** Link/asset base for templates (flips to https://tunnex.io at launch). */
  baseUrl: string;
}

export interface SendResult {
  id: string;
}

export function createMailer(deps: MailerDeps) {
  const resend = new Resend(deps.apiKey);
  const ctx: EmailContext = { baseUrl: deps.baseUrl };

  return {
    async send<K extends EmailKind>(
      kind: K,
      to: string,
      data: TemplateDataMap[K],
    ): Promise<SendResult> {
      const { subject, html, text } = render(kind, data, ctx);
      const { data: sent, error } = await resend.emails.send({
        from: TRANSACTIONAL_FROM,
        replyTo: REPLY_TO,
        to,
        subject,
        html,
        text,
      });

      const toDomain = to.split('@').at(-1) ?? 'invalid';
      if (error || !sent) {
        console.log(
          JSON.stringify({
            event: 'email.send_failed',
            kind,
            toDomain,
            error: error?.message ?? 'no id returned',
          }),
        );
        throw new Error(`email send failed: ${kind}`);
      }

      console.log(JSON.stringify({ event: 'email.sent', kind, toDomain, id: sent.id }));
      return { id: sent.id };
    },
  };
}

export type Mailer = ReturnType<typeof createMailer>;
