import { z } from 'zod';
import { guardFormPost, type GuardDeps } from './http/form-guard.ts';
import { jsonError } from './http/errors.ts';
import { FORM_POST_RULE } from './http/rate-limit.ts';
import type { Mailer } from './email/mailer.ts';

/**
 * Enterprise lead intake (S2.4): plain form-encoded POST (works without JS),
 * Turnstile + 5/min guard, D1 insert is the primary record, then a
 * notification email to SALES_NOTIFY_EMAIL. A mailer failure never loses the
 * lead — the row is already in D1 and the failure is logged.
 */

export const leadInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),
  company: z.string().trim().min(1).max(200),
  seats: z.coerce.number().int().min(1).max(1_000_000).optional(),
  message: z.string().trim().max(2000).optional().default(''),
  turnstileToken: z.string().min(1).max(4096),
});

export interface LeadStore {
  insert(lead: {
    name: string;
    email: string;
    company: string;
    seats: number | null;
    message: string;
  }): Promise<void>;
}

export interface LeadDeps extends GuardDeps {
  store: LeadStore;
  mailer: Pick<Mailer, 'send'>;
  notifyEmail: string;
}

export async function processLead(deps: LeadDeps, request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, 'invalid_request', 'Send a form POST.');

  const parsed = leadInput.safeParse({
    name: form.get('name'),
    email: form.get('email'),
    company: form.get('company'),
    seats: form.get('seats') || undefined,
    message: form.get('message') ?? '',
    turnstileToken: form.get('cf-turnstile-response'),
  });
  if (!parsed.success) {
    return redirect303('/enterprise?state=invalid');
  }

  const guarded = await guardFormPost(deps, request, FORM_POST_RULE, parsed.data.turnstileToken);
  if (guarded) {
    // Guard errors are JSON for API callers; the no-JS form gets a friendly
    // redirect with the same information carried in the state param.
    const code = guarded.status === 429 ? 'rate_limited' : 'captcha';
    return redirect303(`/enterprise?state=${code}`);
  }

  const { name, email, company, message } = parsed.data;
  const seats = parsed.data.seats ?? null;
  await deps.store.insert({ name, email, company, seats, message });
  console.log(JSON.stringify({ event: 'lead.stored', company }));

  try {
    await deps.mailer.send('enterprise-lead', deps.notifyEmail, {
      name,
      email,
      company,
      seats: seats === null ? 'not specified' : String(seats),
      message: message || '(no message)',
    });
  } catch {
    // Logged by the mailer; the lead is already safe in D1.
    console.log(JSON.stringify({ event: 'lead.notify_failed', company }));
  }

  return redirect303('/enterprise/thanks');
}

export function d1LeadStore(db: D1Database): LeadStore {
  return {
    async insert(lead) {
      await db
        .prepare(
          'INSERT INTO enterprise_leads (name, email, company, seats, message) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(lead.name, lead.email, lead.company, lead.seats, lead.message)
        .run();
    },
  };
}

function redirect303(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
