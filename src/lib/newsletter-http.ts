import { guardFormPost, type GuardDeps } from './http/form-guard.ts';
import { jsonError, jsonOk } from './http/errors.ts';
import { FORM_POST_RULE, VERIFY_POST_RULE, checkRateLimit } from './http/rate-limit.ts';
import {
  GENERIC_SUBSCRIBE_MESSAGE,
  handleConfirm,
  handleSubscribe,
  subscribeInput,
  type SubscriberStore,
} from './newsletter.ts';
import type { Mailer } from './email/mailer.ts';

/**
 * HTTP handlers for the newsletter flows, dependency-injected so the whole
 * pipeline is unit-testable. The Astro endpoint files are thin glue that
 * builds Deps from the Worker env.
 */

export interface NewsletterDeps extends GuardDeps {
  store: SubscriberStore;
  mailer: Pick<Mailer, 'send'>;
  baseUrl: string;
  now?: () => number;
}

/** POST /api/subscribe — Turnstile + 5/min limit, generic no-enumeration response. */
export async function processSubscribe(deps: NewsletterDeps, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Send a JSON body.');
  }
  const parsed = subscribeInput.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', 'Enter a valid email address.');
  }

  const guarded = await guardFormPost(deps, request, FORM_POST_RULE, parsed.data.turnstileToken);
  if (guarded) return guarded;

  try {
    await handleSubscribe(deps, parsed.data.email, deps.now);
  } catch {
    console.log(JSON.stringify({ event: 'subscribe.failed' }));
    return jsonError(500, 'internal_error', 'Something went wrong. Try again shortly.');
  }
  // Identical body for new, pending, and already-confirmed addresses.
  return jsonOk({ message: GENERIC_SUBSCRIBE_MESSAGE });
}

/**
 * POST /api/subscribe/confirm — the explicit consume (form-encoded, no JS
 * needed). Token-authenticated, so no Turnstile; verify-tier rate limit.
 * Redirects: confirmed → /subscribe/confirmed · anything else → the confirm
 * page's invalid state.
 */
export async function processConfirm(deps: NewsletterDeps, request: Request): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rate = await checkRateLimit(deps.rateLimitKv, VERIFY_POST_RULE, ip, deps.now);
  if (!rate.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  }

  const form = await request.formData().catch(() => null);
  const token = form?.get('token');
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return redirect303('/subscribe/confirm?state=invalid');
  }

  const outcome = await handleConfirm(deps, token, deps.now);
  return outcome === 'confirmed'
    ? redirect303('/subscribe/confirmed')
    : redirect303('/subscribe/confirm?state=invalid');
}

function redirect303(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
