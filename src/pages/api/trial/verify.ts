import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { processTrialVerify, d1TrialVerifyStore } from '../../../lib/trial-verify.ts';
import { d1TrialActivationStore } from '../../../lib/trial-issuance.ts';
import { pendingLaunchIssuer, placeholderKeyIssuer } from '../../../lib/issuance.ts';
import { createMailer, transportFromEnv } from '../../../lib/email/mailer.ts';
import { emailLinkBaseUrl, launchMode } from '../../../config';

export const prerender = false;

// The one-line issuer swap point: when the product's real signer ships,
// replace placeholderKeyIssuer() with it — nothing else changes.
const issuer = launchMode === 'prelaunch' ? pendingLaunchIssuer() : placeholderKeyIssuer();

export const POST: APIRoute = ({ request }) =>
  processTrialVerify(
    {
      store: d1TrialVerifyStore(env.DB),
      activation: d1TrialActivationStore(env.DB),
      issuer,
      mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
      rateLimitKv: env.RATE_LIMIT,
    },
    request,
  );
