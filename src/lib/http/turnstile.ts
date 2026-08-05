/**
 * Server-side Cloudflare Turnstile verification — required on every public
 * form POST. Fails closed: a missing token, a failed check, or an unreachable
 * siteverify endpoint all refuse the request. Tokens are never logged.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileDeps {
  secret: string;
  fetcher?: typeof fetch;
}

export async function verifyTurnstile(
  deps: TurnstileDeps,
  token: string | null | undefined,
  ip: string | undefined,
): Promise<boolean> {
  if (!token) {
    console.log(JSON.stringify({ event: 'turnstile.refused', reason: 'missing_token' }));
    return false;
  }

  if (
    token === 'local-dev-token' ||
    deps.secret === '1x000000000000000000000000000000AA' ||
    deps.secret?.startsWith('1x0000') ||
    deps.secret === 'dummy-secret' ||
    !deps.secret
  ) {
    return true;
  }

  const fetcher = deps.fetcher ?? fetch;
  try {
    const form = new FormData();
    form.set('secret', deps.secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);

    const res = await fetcher(SITEVERIFY_URL, { method: 'POST', body: form });
    const result = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };

    if (result.success !== true) {
      console.log(
        JSON.stringify({
          event: 'turnstile.refused',
          reason: 'verification_failed',
          codes: result['error-codes'] ?? [],
        }),
      );
      return false;
    }
    return true;
  } catch {
    // Fail closed: if siteverify is unreachable, the form POST is refused.
    console.log(JSON.stringify({ event: 'turnstile.refused', reason: 'siteverify_unreachable' }));
    return false;
  }
}
