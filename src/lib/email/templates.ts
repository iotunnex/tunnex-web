import { renderShell, button, paragraph, muted, escapeHtml } from './layout.ts';
import { EMAIL } from './palette.ts';

/**
 * Every outbound email, typed by kind. Each renderer returns subject + an
 * HTML/plaintext pair. Raw tokens never appear here — only complete URLs
 * minted by the caller (and they are never logged; see mailer.ts).
 */

export interface EmailContext {
  /** Base for links and hosted assets (flips to https://tunnex.io at launch). */
  baseUrl: string;
}

export interface TemplateDataMap {
  'trial-verify': { domain: string; verifyUrl: string };
  'trial-already-exists': { domain: string };
  'trial-approved': { domain: string };
  'trial-key-delivery': { domain: string; licenseKey: string; expiresAt: string };
  'trial-d10-reminder': { domain: string; daysLeft: number; expiresAt: string };
  'trial-expired-upgrade': { domain: string };
  'trial-d21-followup': { domain: string };
  'newsletter-confirm': { confirmUrl: string };
  'enterprise-lead': {
    name: string;
    email: string;
    company: string;
    seats: string;
    message: string;
  };
}

export type EmailKind = keyof TemplateDataMap;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Renderers = {
  [K in EmailKind]: (data: TemplateDataMap[K], ctx: EmailContext) => RenderedEmail;
};

const renderers: Renderers = {
  'trial-verify': ({ domain, verifyUrl }, ctx) => ({
    subject: 'Confirm your Tunnex trial request',
    html: shell(
      'Confirm your Tunnex trial request',
      ctx,
      paragraph(
        `You requested a 14-day Tunnex Enterprise trial for <strong>${escapeHtml(domain)}</strong>.`,
      ) +
        paragraph('Confirm it from the device where you want to finish setup:') +
        button(verifyUrl, 'Confirm trial request') +
        muted(
          'This link is valid for 30 minutes and can be used once. If you didn’t request a trial, ignore this email — nothing happens without confirmation.',
        ),
    ),
    text: [
      `You requested a 14-day Tunnex Enterprise trial for ${domain}.`,
      '',
      'Confirm it here (valid 30 minutes, single use):',
      verifyUrl,
      '',
      'If you didn’t request a trial, ignore this email — nothing happens without confirmation.',
    ].join('\n'),
  }),

  'trial-already-exists': ({ domain }, ctx) => ({
    subject: `${domain} already has a Tunnex trial`,
    html: shell(
      `${domain} already has a Tunnex trial`,
      ctx,
      paragraph(
        `Someone at <strong>${escapeHtml(domain)}</strong> already started a Tunnex Enterprise trial, and trials are one per company domain.`,
      ) +
        paragraph(
          'If you can’t find who has it, or the trial ended and you want more time, we’ll sort it out:',
        ) +
        button('mailto:sales@tunnex.io?subject=Trial%20for%20' + domain, 'Contact sales'),
    ),
    text: [
      `Someone at ${domain} already started a Tunnex Enterprise trial, and trials are one per company domain.`,
      '',
      'If you can’t find who has it, or the trial ended and you want more time, write to sales@tunnex.io and we’ll sort it out.',
    ].join('\n'),
  }),

  'trial-approved': ({ domain }, ctx) => ({
    subject: 'Your Tunnex trial is approved',
    html: shell(
      'Your Tunnex trial is approved',
      ctx,
      paragraph(
        `Your 14-day Tunnex Enterprise trial for <strong>${escapeHtml(domain)}</strong> is approved.`,
      ) +
        paragraph(
          'Tunnex is launching soon: your license key will arrive in this inbox the moment the beta opens, and your 14 days start only when the key is issued — you lose nothing by being early.',
        ),
    ),
    text: [
      `Your 14-day Tunnex Enterprise trial for ${domain} is approved.`,
      '',
      'Tunnex is launching soon: your license key will arrive in this inbox the moment the beta opens. Your 14 days start only when the key is issued — you lose nothing by being early.',
    ].join('\n'),
  }),

  'trial-key-delivery': ({ domain, licenseKey, expiresAt }, ctx) => ({
    subject: 'Your Tunnex Enterprise trial key',
    html: shell(
      'Your Tunnex Enterprise trial key',
      ctx,
      paragraph(
        `Welcome! Here is the 14-day Enterprise trial key for <strong>${escapeHtml(domain)}</strong> (valid until ${escapeHtml(expiresAt)}):`,
      ) +
        `<pre style="background-color:${EMAIL.bg};border:1px solid ${EMAIL.border};border-radius:6px;padding:12px;font-size:13px;overflow-x:auto;">${escapeHtml(licenseKey)}</pre>` +
        paragraph('Paste it into your control plane — no reinstall, features unlock in place.') +
        button(`${ctx.baseUrl}/docs/quickstart/`, 'Follow the quickstart'),
    ),
    text: [
      `Welcome! Here is the 14-day Tunnex Enterprise trial key for ${domain} (valid until ${expiresAt}):`,
      '',
      licenseKey,
      '',
      'Paste it into your control plane — no reinstall, features unlock in place.',
      `Quickstart: ${ctx.baseUrl}/docs/quickstart/`,
    ].join('\n'),
  }),

  'trial-d10-reminder': ({ domain, daysLeft, expiresAt }, ctx) => ({
    subject: `${daysLeft} days left in your Tunnex trial`,
    html: shell(
      `${daysLeft} days left in your Tunnex trial`,
      ctx,
      paragraph(
        `The Enterprise trial for <strong>${escapeHtml(domain)}</strong> ends on ${escapeHtml(expiresAt)}.`,
      ) +
        paragraph(
          'When it does, Enterprise features lapse to the Open tier and your VPN keeps running — nothing breaks. If SSO, policies, or multi-org earned their keep, let’s talk pricing before the deadline.',
        ) +
        button('mailto:sales@tunnex.io?subject=Tunnex%20Enterprise', 'Talk to sales'),
    ),
    text: [
      `The Tunnex Enterprise trial for ${domain} ends on ${expiresAt}.`,
      '',
      'When it does, Enterprise features lapse to the Open tier and your VPN keeps running — nothing breaks.',
      'If SSO, policies, or multi-org earned their keep, write to sales@tunnex.io before the deadline.',
    ].join('\n'),
  }),

  'trial-expired-upgrade': ({ domain }, ctx) => ({
    subject: 'Your Tunnex trial has ended',
    html: shell(
      'Your Tunnex trial has ended',
      ctx,
      paragraph(
        `The Enterprise trial for <strong>${escapeHtml(domain)}</strong> has ended. Your deployment lapsed to the Open tier and keeps working — your network never depended on us.`,
      ) +
        paragraph(
          'Want SSO, Zero Trust policies, and multi-org back? Upgrading is pasting a new key.',
        ) +
        button(`${ctx.baseUrl}/pricing/`, 'See Enterprise pricing'),
    ),
    text: [
      `The Tunnex Enterprise trial for ${domain} has ended. Your deployment lapsed to the Open tier and keeps working — your network never depended on us.`,
      '',
      'Want SSO, Zero Trust policies, and multi-org back? Upgrading is pasting a new key.',
      `Pricing: ${ctx.baseUrl}/pricing/`,
    ].join('\n'),
  }),

  'trial-d21-followup': ({ domain }, ctx) => ({
    subject: 'How did your Tunnex trial go?',
    html: shell(
      'How did your Tunnex trial go?',
      ctx,
      paragraph(
        `A week ago the Enterprise trial for <strong>${escapeHtml(domain)}</strong> ended. One honest question: what stopped you?`,
      ) +
        paragraph(
          'Price, a missing feature, a rough edge — reply and tell us. We read every answer, and it directly shapes what we build next.',
        ),
    ),
    text: [
      `A week ago the Tunnex Enterprise trial for ${domain} ended. One honest question: what stopped you?`,
      '',
      'Price, a missing feature, a rough edge — reply and tell us. We read every answer, and it directly shapes what we build next.',
    ].join('\n'),
  }),

  'newsletter-confirm': ({ confirmUrl }, ctx) => ({
    subject: 'Confirm your subscription to Tunnex updates',
    html: shell(
      'Confirm your subscription to Tunnex updates',
      ctx,
      paragraph('One click and you’re on the list — launch news and release notes, nothing else.') +
        button(confirmUrl, 'Confirm subscription') +
        muted(
          'This link is valid for 30 minutes and can be used once. If you didn’t subscribe, ignore this email and you won’t hear from us.',
        ),
    ),
    text: [
      'One click and you’re on the list — launch news and release notes, nothing else.',
      '',
      'Confirm here (valid 30 minutes, single use):',
      confirmUrl,
      '',
      'If you didn’t subscribe, ignore this email and you won’t hear from us.',
    ].join('\n'),
  }),

  'enterprise-lead': ({ name, email, company, seats, message }, ctx) => ({
    subject: `New enterprise lead: ${company}`,
    html: shell(
      `New enterprise lead: ${company}`,
      ctx,
      paragraph(`<strong>${escapeHtml(name)}</strong> (${escapeHtml(email)})`) +
        paragraph(`Company: ${escapeHtml(company)}<br>Seats: ${escapeHtml(seats)}`) +
        paragraph(`Message:<br>${escapeHtml(message)}`),
    ),
    text: [
      `New enterprise lead: ${company}`,
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Company: ${company}`,
      `Seats: ${seats}`,
      '',
      'Message:',
      message,
    ].join('\n'),
  }),
};

function shell(title: string, ctx: EmailContext, bodyHtml: string): string {
  return renderShell({ title, bodyHtml, assetBaseUrl: ctx.baseUrl });
}

export function render<K extends EmailKind>(
  kind: K,
  data: TemplateDataMap[K],
  ctx: EmailContext,
): RenderedEmail {
  return renderers[kind](data, ctx);
}
